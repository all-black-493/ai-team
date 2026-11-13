import {
  Daytona,
  DaytonaNotFoundError,
  type CreateSandboxFromSnapshotParams,
  type Sandbox,
} from "@daytona/sdk"

import { db } from "@/db"
import { sandboxEvents } from "@/db/schema"
import { domainsOf, type NetworkPolicy } from "@/lib/sandbox-policy"

// Server code only, though there's no "server-only" guard: the Trigger.dev
// agent imports this too, and that package throws outside React's server
// environment.

// Made per call: the constructor throws when DAYTONA_API_KEY is missing, and
// at module level that would break every action that imports this file.
function daytona() {
  // The endpoint is passed explicitly. Otherwise, when a .env file in the
  // working directory also sets it (trigger dev loads .env into the worker),
  // the SDK can't tell where it came from and refuses to run. Unset, it's
  // Daytona's default.
  return new Daytona({ apiUrl: process.env.DAYTONA_API_URL })
}

export type SandboxOwner = { userId?: string | null; botId?: string | null }

export type SandboxPolicy = {
  networkPolicy: NetworkPolicy
  allowedDomains: string | null
  autoStopMinutes: number
  autoArchiveDays: number
}

// Times a Daytona call and records how it went.
export async function tracked<T>(
  sandboxId: string,
  action: string,
  owner: SandboxOwner,
  run: () => Promise<T>,
  cold = false
) {
  const started = Date.now()
  try {
    const result = await run()
    await record(sandboxId, action, owner, true, started, cold)
    return result
  } catch (error) {
    await record(sandboxId, action, owner, false, started, cold, error)
    throw error
  }
}

export async function recordSandboxCall(
  sandboxId: string,
  action: string,
  owner: SandboxOwner,
  call: { ok: boolean; started: number; cold?: boolean; error?: unknown }
) {
  await record(
    sandboxId,
    action,
    owner,
    call.ok,
    call.started,
    call.cold ?? false,
    call.error
  )
}

async function record(
  sandboxId: string,
  action: string,
  owner: SandboxOwner,
  ok: boolean,
  started: number,
  cold: boolean,
  error?: unknown
) {
  await db
    .insert(sandboxEvents)
    .values({
      sandboxId,
      action,
      userId: owner.userId ?? null,
      botId: owner.botId ?? null,
      ok,
      cold,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message.slice(0, 500) : null,
    })
    .catch((failure) =>
      console.error("Couldn't record a sandbox event", failure)
    )
}

function networkParams(policy: SandboxPolicy) {
  if (policy.networkPolicy === "blocked") return { networkBlockAll: true }
  if (policy.networkPolicy === "domains") {
    return { domainAllowList: domainsOf(policy.allowedDomains).join(",") }
  }
  return {}
}

const lifecycleParams = (policy: SandboxPolicy) => ({
  autoStopInterval: policy.autoStopMinutes,
  autoArchiveInterval: policy.autoArchiveDays * 24 * 60,
})

// Each bot gets its own Daytona sandbox, created with the bot under its
// network and idle policy. Returns the ID to keep on the bot row.
export async function createBotSandbox(
  policy: SandboxPolicy,
  owner: SandboxOwner
) {
  const started = Date.now()
  const params: CreateSandboxFromSnapshotParams = {
    ...networkParams(policy),
    ...lifecycleParams(policy),
  }
  try {
    const sandbox = await daytona().create(params)
    await record(sandbox.id, "create", owner, true, started, true)
    return sandbox.id
  } catch (error) {
    await record("none", "create", owner, false, started, true, error)
    throw error
  }
}

// Applies a changed policy to a bot's sandbox. Lifecycle settings always
// apply; Daytona refuses network settings below its Tier 3, and that
// refusal comes back as `networkError` rather than failing the rest.
export async function applySandboxPolicy(
  sandboxId: string,
  policy: SandboxPolicy,
  owner: SandboxOwner
) {
  const sandbox = await tracked(sandboxId, "get", owner, () =>
    daytona().get(sandboxId)
  )
  const lifecycle = lifecycleParams(policy)
  await tracked(sandboxId, "set-autostop", owner, () =>
    sandbox.setAutostopInterval(lifecycle.autoStopInterval)
  )
  await tracked(sandboxId, "set-autoarchive", owner, () =>
    sandbox.setAutoArchiveInterval(lifecycle.autoArchiveInterval)
  )
  const network =
    policy.networkPolicy === "default"
      ? { networkBlockAll: false }
      : networkParams(policy)
  try {
    await tracked(sandboxId, "set-network", owner, () =>
      sandbox.updateNetworkSettings(network)
    )
    return { networkError: null }
  } catch (error) {
    return {
      networkError:
        error instanceof Error ? error.message : "Daytona refused it",
    }
  }
}

export async function deleteBotSandbox(
  sandboxId: string,
  owner: SandboxOwner = {}
) {
  const client = daytona()
  try {
    await tracked(sandboxId, "delete", owner, async () =>
      client.delete(await client.get(sandboxId))
    )
  } catch (error) {
    // Already gone, which is what we wanted.
    if (error instanceof DaytonaNotFoundError) return
    throw error
  }
}

// A bot's sandbox, ready to use. An idle sandbox stops itself after a while,
// and a stopped or archived one is started again here.
export async function getStartedSandbox(
  sandboxId: string,
  owner: SandboxOwner = {}
) {
  const sandbox = await tracked(sandboxId, "get", owner, () =>
    daytona().get(sandboxId)
  )
  if (sandbox.state === "starting") {
    await tracked(
      sandboxId,
      "start",
      owner,
      () => sandbox.waitUntilStarted(),
      true
    )
  } else if (sandbox.state !== "started") {
    await tracked(sandboxId, "start", owner, () => sandbox.start(), true)
  }
  return sandbox
}

// The desktop (Xvfb, xfce, x11vnc and noVNC) starts when first needed.
export async function startDesktop(sandbox: Sandbox, owner: SandboxOwner = {}) {
  const { status } = await tracked(sandbox.id, "desktop-status", owner, () =>
    sandbox.computerUse.getStatus()
  )
  if (status !== "active") {
    await tracked(
      sandbox.id,
      "desktop-start",
      owner,
      () => sandbox.computerUse.start(),
      true
    )
  }
}

// noVNC, served by websockify on port 6080 in Daytona's default snapshot.
const NOVNC_PORT = 6080

// A bot's sandbox with its desktop running.
export async function startBotDesktop(
  sandboxId: string,
  owner: SandboxOwner = {}
) {
  const sandbox = await getStartedSandbox(sandboxId, owner)
  await startDesktop(sandbox, owner)
  return sandbox
}

// A link to the desktop in noVNC, scaled to fit and reconnecting by itself.
// Signed, so an iframe can load it without headers. It survives sandbox
// restarts until it expires; Daytona allows up to 24 hours.
export async function signDesktopUrl(sandbox: Sandbox, seconds: number) {
  const { url } = await sandbox.getSignedPreviewUrl(NOVNC_PORT, seconds)
  return `${url}/vnc.html?autoconnect=true&resize=scale&reconnect=true`
}
