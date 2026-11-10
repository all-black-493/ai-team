import { Daytona, DaytonaNotFoundError, type Sandbox } from "@daytona/sdk"

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

// Bots' sandboxes run as Daytona's default user, whose home this is.
const SANDBOX_HOME = "/home/daytona"

// A bot's memory: a Markdown file in its sandbox that it reads and writes to
// remember things from one chat to the next, its private chat and its groups
// alike (see the instructions in trigger/chat.ts).
const MEMORY_FILE = "MEMORY.md"
export const MEMORY_PATH = `${SANDBOX_HOME}/${MEMORY_FILE}`

// Each bot gets its own Daytona sandbox, created with the bot and its blank
// memory file. Returns the ID to keep on the bot row. If the file can't be
// made, the sandbox is deleted again and the bot isn't created.
export async function createBotSandbox() {
  const client = daytona()
  const sandbox = await client.create()
  try {
    const { exitCode, result } = await sandbox.process.executeCommand(
      `touch ${MEMORY_FILE}`,
      SANDBOX_HOME
    )
    if (exitCode !== 0) {
      throw new Error(`Couldn't create ${MEMORY_PATH}: ${result}`)
    }
  } catch (error) {
    await client
      .delete(sandbox)
      .catch((cleanupError) =>
        console.error(
          `Couldn't delete sandbox ${sandbox.id} after a failed setup`,
          cleanupError
        )
      )
    throw error
  }
  return sandbox.id
}

export async function deleteBotSandbox(sandboxId: string) {
  const client = daytona()
  try {
    await client.delete(await client.get(sandboxId))
  } catch (error) {
    // Already gone, which is what we wanted.
    if (error instanceof DaytonaNotFoundError) return
    throw error
  }
}

// A bot's sandbox, ready to use. An idle sandbox stops itself after a while,
// and a stopped or archived one is started again here.
export async function getStartedSandbox(sandboxId: string) {
  const sandbox = await daytona().get(sandboxId)
  if (sandbox.state === "starting") {
    await sandbox.waitUntilStarted()
  } else if (sandbox.state !== "started") {
    await sandbox.start()
  }
  return sandbox
}

// The desktop (Xvfb, xfce, x11vnc and noVNC) starts when first needed.
export async function startDesktop(sandbox: Sandbox) {
  const { status } = await sandbox.computerUse.getStatus()
  if (status !== "active") await sandbox.computerUse.start()
}

// noVNC, served by websockify on port 6080 in Daytona's default snapshot.
const NOVNC_PORT = 6080

// A bot's sandbox with its desktop running.
export async function startBotDesktop(sandboxId: string) {
  const sandbox = await getStartedSandbox(sandboxId)
  await startDesktop(sandbox)
  return sandbox
}

// A link to the desktop in noVNC, scaled to fit and reconnecting by itself.
// Signed, so an iframe can load it without headers. It survives sandbox
// restarts until it expires; Daytona allows up to 24 hours.
export async function signDesktopUrl(sandbox: Sandbox, seconds: number) {
  const { url } = await sandbox.getSignedPreviewUrl(NOVNC_PORT, seconds)
  return `${url}/vnc.html?autoconnect=true&resize=scale&reconnect=true`
}
