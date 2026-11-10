import { Daytona, DaytonaNotFoundError } from "@daytona/sdk"

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

// Each bot gets its own Daytona sandbox, created with the bot. Returns the ID
// to keep on the bot row.
export async function createBotSandbox() {
  const sandbox = await daytona().create()
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
