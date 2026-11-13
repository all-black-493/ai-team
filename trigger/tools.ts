import { createMCPClient } from "@ai-sdk/mcp"
import type { Sandbox } from "@daytona/sdk"
import { tool } from "ai"
import { z } from "zod"

import { getChatBot } from "@/chats/bot"
import {
  getStartedSandbox,
  startDesktop,
  type SandboxOwner,
} from "@/lib/sandbox"

type BotSandbox = {
  getBot: () => Promise<{ name: string }>
  getSandbox: () => Promise<Sandbox>
  owner?: SandboxOwner
}

// Long output is cut to its tail so one noisy command can't flood the model's
// context or cross the chat stream's ~1 MiB per-chunk limit.
const MAX_OUTPUT = 20_000
// Images go through the chat stream as base64, which adds a third.
const MAX_IMAGE_BYTES = 700_000

function clip(text: string) {
  if (text.length <= MAX_OUTPUT) return text
  const cut = text.length - MAX_OUTPUT
  return `[${cut} earlier characters cut]\n${text.slice(-MAX_OUTPUT)}`
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const imageTypes: Record<string, string> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
}

// A background process is addressed as "session/command".
function parseProcessId(processId: string) {
  const [sessionId, commandId] = processId.split("/")
  if (!sessionId || !commandId) {
    throw new Error(`Not a process ID: ${processId}`)
  }
  return { sessionId, commandId }
}

type Image = { mediaType: string; data: string }

// What the model sees for an image result: the picture itself. Called from
// an inline arrow: passed directly, it throws off tool()'s type inference.
function imageToModel(output: Image) {
  return {
    type: "content" as const,
    value: [
      {
        type: "file" as const,
        mediaType: output.mediaType,
        data: { type: "data" as const, data: output.data },
      },
    ],
  }
}

const languages = z.enum(["python", "typescript", "javascript"])
const gitAuth = {
  username: z
    .string()
    .optional()
    .describe("For a private remote, with a token as the password."),
  password: z.string().optional(),
}

// Everything a bot can do in its own Daytona sandbox: commands, code, files,
// git, code intelligence, the desktop, preview links and MCP servers.
export function createBotTools({ getBot, getSandbox, owner }: BotSandbox) {
  // The desktop starts the first time a turn needs it.
  let desktop: Promise<void> | undefined
  async function getComputer() {
    const sandbox = await getSandbox()
    desktop ??= startDesktop(sandbox, owner).catch((error) => {
      desktop = undefined
      throw error
    })
    await desktop
    return sandbox.computerUse
  }

  // Full scale, so the model's coordinates match the screen's pixels.
  async function screenshot(): Promise<Image> {
    const computer = await getComputer()
    const shot = await computer.screenshot.takeCompressed({
      format: "jpeg",
      quality: 70,
    })
    if (!shot.screenshot) throw new Error("The screenshot came back empty")
    return { mediaType: "image/jpeg", data: shot.screenshot }
  }

  return {
    // Commands and code ----------------------------------------------------

    run_command: tool({
      description:
        "Run a shell command in your sandbox. Output streams while it runs. Set background for servers and other long-running processes, then use read_process_logs and stop_process.",
      inputSchema: z.object({
        command: z.string(),
        cwd: z.string().optional().describe("Working directory."),
        background: z.boolean().optional(),
        timeoutSeconds: z
          .number()
          .int()
          .min(1)
          .max(600)
          .optional()
          .describe(
            "How long to wait before leaving it running in the background. Defaults to 120."
          ),
      }),
      async *execute(
        { command, cwd, background, timeoutSeconds = 120 },
        { abortSignal }
      ) {
        const sandbox = await getSandbox()
        const sessionId = `cmd-${crypto.randomUUID()}`
        await sandbox.process.createSession(sessionId)
        const { cmdId } = await sandbox.process.executeSessionCommand(
          sessionId,
          {
            command: cwd ? `cd ${shellQuote(cwd)} && ${command}` : command,
            runAsync: true,
          }
        )
        const processId = `${sessionId}/${cmdId}`
        if (background) {
          yield { status: "running" as const, processId, output: "" }
          return
        }

        // Log streaming: collect output as it arrives and show it live.
        let output = ""
        let finished = false
        sandbox.process
          .getSessionCommandLogs(
            sessionId,
            cmdId,
            (chunk) => (output += chunk),
            (chunk) => (output += chunk)
          )
          .catch(() => {})
          .finally(() => (finished = true))
        const deadline = Date.now() + timeoutSeconds * 1000
        while (!finished && Date.now() < deadline && !abortSignal?.aborted) {
          await sleep(750)
          yield { status: "running" as const, processId, output: clip(output) }
        }

        if (abortSignal?.aborted) {
          await sandbox.process.deleteSession(sessionId)
          yield { status: "stopped" as const, output: clip(output) }
          return
        }
        if (!finished) {
          yield { status: "running" as const, processId, output: clip(output) }
          return
        }
        const { exitCode } = await sandbox.process.getSessionCommand(
          sessionId,
          cmdId
        )
        await sandbox.process.deleteSession(sessionId)
        yield { status: "finished" as const, exitCode, output: clip(output) }
      },
    }),

    read_process_logs: tool({
      description:
        "Read the output so far of a process started by run_command, and its exit code once it has finished.",
      inputSchema: z.object({ processId: z.string() }),
      execute: async ({ processId }) => {
        const sandbox = await getSandbox()
        const { sessionId, commandId } = parseProcessId(processId)
        const [logs, command] = await Promise.all([
          sandbox.process.getSessionCommandLogs(sessionId, commandId),
          sandbox.process.getSessionCommand(sessionId, commandId),
        ])
        return {
          exitCode: command.exitCode,
          output: clip(logs.output ?? ""),
        }
      },
    }),

    stop_process: tool({
      description: "Stop a process started by run_command.",
      inputSchema: z.object({ processId: z.string() }),
      execute: async ({ processId }) => {
        const sandbox = await getSandbox()
        await sandbox.process.deleteSession(parseProcessId(processId).sessionId)
        return { stopped: processId }
      },
    }),

    run_code: tool({
      description:
        "Run Python code in your sandbox. For other languages, write a file and use run_command.",
      inputSchema: z.object({ code: z.string() }),
      execute: async ({ code }) => {
        const sandbox = await getSandbox()
        const { exitCode, result } = await sandbox.process.codeRun(
          code,
          undefined,
          120
        )
        return { exitCode, output: clip(result) }
      },
    }),

    // Files ------------------------------------------------------------------

    list_files: tool({
      description: "List the files and folders in a folder of your sandbox.",
      inputSchema: z.object({
        path: z.string().describe("Folder path. Use . for the working folder."),
      }),
      execute: async ({ path }) => {
        const sandbox = await getSandbox()
        const files = await sandbox.fs.listFiles(path)
        return files.slice(0, 500).map((file) => ({
          name: file.name,
          isDir: file.isDir,
          size: file.size,
        }))
      },
    }),

    read_file: tool({
      description: "Read a text file from your sandbox.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const sandbox = await getSandbox()
        const buffer = await sandbox.fs.downloadFile(path)
        if (buffer.includes(0)) {
          return {
            path,
            content: `Binary file, ${buffer.length} bytes. Use view_image for an image, or run_command to inspect it.`,
          }
        }
        return { path, content: clip(buffer.toString("utf8")) }
      },
    }),

    write_file: tool({
      description:
        "Create or overwrite a text file in your sandbox. Missing folders are created.",
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) => {
        const sandbox = await getSandbox()
        const folder = path.includes("/")
          ? path.slice(0, path.lastIndexOf("/"))
          : ""
        if (folder) {
          await sandbox.process.executeCommand(`mkdir -p ${shellQuote(folder)}`)
        }
        const buffer = Buffer.from(content, "utf8")
        await sandbox.fs.uploadFile(buffer, path)
        return { path, bytes: buffer.length }
      },
    }),

    edit_file: tool({
      description:
        "Replace text in a file in your sandbox. oldText must match exactly, and only once unless replaceAll is set.",
      inputSchema: z.object({
        path: z.string(),
        oldText: z.string().min(1),
        newText: z.string(),
        replaceAll: z.boolean().optional(),
      }),
      execute: async ({ path, oldText, newText, replaceAll }) => {
        const sandbox = await getSandbox()
        const content = (await sandbox.fs.downloadFile(path)).toString("utf8")
        const count = content.split(oldText).length - 1
        if (count === 0) throw new Error(`oldText isn't in ${path}`)
        if (count > 1 && !replaceAll) {
          throw new Error(
            `oldText is in ${path} ${count} times. Add context so it matches once, or set replaceAll.`
          )
        }
        const updated = replaceAll
          ? content.replaceAll(oldText, newText)
          : content.replace(oldText, () => newText)
        await sandbox.fs.uploadFile(Buffer.from(updated, "utf8"), path)
        return { path, replacements: replaceAll ? count : 1 }
      },
    }),

    find_files: tool({
      description:
        "Find files under a folder of your sandbox whose names match a glob pattern, like *.ts.",
      inputSchema: z.object({ path: z.string(), pattern: z.string() }),
      execute: async ({ path, pattern }) => {
        const sandbox = await getSandbox()
        const { files } = await sandbox.fs.searchFiles(path, pattern)
        return { files: files.slice(0, 500) }
      },
    }),

    search_text: tool({
      description:
        "Search the contents of the files under a folder of your sandbox for a text pattern.",
      inputSchema: z.object({ path: z.string(), pattern: z.string() }),
      execute: async ({ path, pattern }) => {
        const sandbox = await getSandbox()
        const matches = await sandbox.fs.findFiles(path, pattern)
        return matches.slice(0, 200).map((match) => ({
          file: match.file,
          line: match.line,
          content: match.content.slice(0, 300),
        }))
      },
    }),

    move_path: tool({
      description: "Move or rename a file or folder in your sandbox.",
      inputSchema: z.object({ from: z.string(), to: z.string() }),
      execute: async ({ from, to }) => {
        const sandbox = await getSandbox()
        await sandbox.fs.moveFiles(from, to)
        return { from, to }
      },
    }),

    delete_path: tool({
      description:
        "Delete a file, or a folder with recursive set, from your sandbox.",
      inputSchema: z.object({
        path: z.string(),
        recursive: z.boolean().optional(),
      }),
      execute: async ({ path, recursive }) => {
        const sandbox = await getSandbox()
        await sandbox.fs.deleteFile(path, recursive)
        return { deleted: path }
      },
    }),

    create_folder: tool({
      description: "Create a folder in your sandbox.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const sandbox = await getSandbox()
        await sandbox.process.executeCommand(`mkdir -p ${shellQuote(path)}`)
        return { created: path }
      },
    }),

    view_image: tool({
      description:
        "Look at an image file in your sandbox, such as one the user attached. Only you see it.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const mediaType = imageTypes[path.split(".").pop()?.toLowerCase() ?? ""]
        if (!mediaType) {
          throw new Error("Only PNG, JPEG, GIF and WebP images can be viewed")
        }
        const sandbox = await getSandbox()
        const buffer = await sandbox.fs.downloadFile(path)
        if (buffer.length > MAX_IMAGE_BYTES) {
          throw new Error(
            `The image is ${buffer.length} bytes; the limit is ${MAX_IMAGE_BYTES}. Make a smaller copy with run_command first.`
          )
        }
        return { mediaType, data: buffer.toString("base64") } satisfies Image
      },
      toModelOutput: ({ output }) => imageToModel(output),
    }),

    // Git ----------------------------------------------------------------------

    git_clone: tool({
      description: "Clone a git repository into your sandbox.",
      inputSchema: z.object({
        url: z.string(),
        path: z.string().describe("Folder to clone into."),
        branch: z.string().optional(),
        ...gitAuth,
      }),
      execute: async ({ url, path, branch, username, password }) => {
        const sandbox = await getSandbox()
        await sandbox.git.clone(
          url,
          path,
          branch,
          undefined,
          username,
          password
        )
        return { cloned: url, path }
      },
    }),

    git_status: tool({
      description: "Show a repository's branch and changed files.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const sandbox = await getSandbox()
        const status = await sandbox.git.status(path)
        return {
          branch: status.currentBranch,
          ahead: status.ahead,
          behind: status.behind,
          files: status.fileStatus.slice(0, 300),
        }
      },
    }),

    git_add: tool({
      description: "Stage files in a repository.",
      inputSchema: z.object({
        path: z.string(),
        files: z
          .array(z.string())
          .optional()
          .describe("Defaults to everything."),
      }),
      execute: async ({ path, files = ["."] }) => {
        const sandbox = await getSandbox()
        await sandbox.git.add(path, files)
        return { staged: files }
      },
    }),

    git_commit: tool({
      description: "Commit the staged changes in a repository.",
      inputSchema: z.object({ path: z.string(), message: z.string() }),
      execute: async ({ path, message }) => {
        const sandbox = await getSandbox()
        // Authored by the bot.
        const { name } = await getBot()
        const { sha } = await sandbox.git.commit(
          path,
          message,
          name,
          "bot@ai-team.local"
        )
        return { sha }
      },
    }),

    git_branches: tool({
      description: "List a repository's branches.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const sandbox = await getSandbox()
        const { branches } = await sandbox.git.branches(path)
        return { branches }
      },
    }),

    git_checkout: tool({
      description: "Switch a repository to a branch, creating it if asked.",
      inputSchema: z.object({
        path: z.string(),
        branch: z.string(),
        create: z.boolean().optional(),
      }),
      execute: async ({ path, branch, create }) => {
        const sandbox = await getSandbox()
        if (create) await sandbox.git.createBranch(path, branch)
        await sandbox.git.checkoutBranch(path, branch)
        return { branch }
      },
    }),

    git_pull: tool({
      description: "Pull changes from a repository's remote.",
      inputSchema: z.object({ path: z.string(), ...gitAuth }),
      execute: async ({ path, username, password }) => {
        const sandbox = await getSandbox()
        await sandbox.git.pull(path, username, password)
        return { pulled: path }
      },
    }),

    git_push: tool({
      description: "Push a repository's commits to its remote.",
      inputSchema: z.object({ path: z.string(), ...gitAuth }),
      execute: async ({ path, username, password }) => {
        const sandbox = await getSandbox()
        await sandbox.git.push(path, username, password)
        return { pushed: path }
      },
    }),

    // Code intelligence (LSP) --------------------------------------------------

    code_symbols: tool({
      description:
        "List the symbols (functions, classes, variables) in a source file, or search a project for symbols by name, using a language server.",
      inputSchema: z.object({
        language: languages,
        projectPath: z.string(),
        filePath: z
          .string()
          .optional()
          .describe("A file to list the symbols of."),
        query: z
          .string()
          .optional()
          .describe("Without filePath: a name to search the project for."),
      }),
      execute: async ({ language, projectPath, filePath, query }) => {
        const sandbox = await getSandbox()
        const server = await sandbox.createLspServer(language, projectPath)
        await server.start()
        try {
          if (filePath) await server.didOpen(filePath)
          const symbols = filePath
            ? await server.documentSymbols(filePath)
            : await server.workspaceSymbols(query ?? "")
          return symbols.slice(0, 200).map((symbol) => ({
            name: symbol.name,
            kind: symbol.kind,
            location: symbol.location,
          }))
        } finally {
          await server.stop()
        }
      },
    }),

    code_completions: tool({
      description:
        "Get a language server's completions at a position in a source file. Lines and characters count from 0.",
      inputSchema: z.object({
        language: languages,
        projectPath: z.string(),
        filePath: z.string(),
        line: z.number().int().min(0),
        character: z.number().int().min(0),
      }),
      execute: async ({ language, projectPath, filePath, line, character }) => {
        const sandbox = await getSandbox()
        const server = await sandbox.createLspServer(language, projectPath)
        await server.start()
        try {
          await server.didOpen(filePath)
          const { items } = await server.completions(filePath, {
            line,
            character,
          })
          return items.slice(0, 50).map((item) => ({
            label: item.label,
            kind: item.kind,
            detail: item.detail,
          }))
        } finally {
          await server.stop()
        }
      },
    }),

    // Desktop (computer use) ---------------------------------------------------

    view_screen: tool({
      description:
        "Take a screenshot of your desktop to see what's on it. Only you see it: look before you click or type, and again to check the result.",
      inputSchema: z.object({}),
      execute: () => screenshot(),
      toModelOutput: ({ output }) => imageToModel(output),
    }),

    show_screen: tool({
      description:
        "Take a screenshot of your desktop and show it to the user in the chat. Use it when the user wants to see the screen.",
      inputSchema: z.object({}),
      execute: () => screenshot(),
      toModelOutput: ({ output }) => imageToModel(output),
    }),

    mouse_click: tool({
      description: "Click the mouse at a point on your desktop.",
      inputSchema: z.object({
        x: z.number().int(),
        y: z.number().int(),
        button: z.enum(["left", "right", "middle"]).optional(),
        double: z.boolean().optional(),
      }),
      execute: async ({ x, y, button = "left", double }) => {
        const computer = await getComputer()
        await computer.mouse.click(x, y, button, double)
        return { clicked: { x, y } }
      },
    }),

    mouse_move: tool({
      description: "Move the mouse to a point on your desktop.",
      inputSchema: z.object({ x: z.number().int(), y: z.number().int() }),
      execute: async ({ x, y }) => {
        const computer = await getComputer()
        await computer.mouse.move(x, y)
        return { movedTo: { x, y } }
      },
    }),

    mouse_drag: tool({
      description: "Drag the mouse from one point on your desktop to another.",
      inputSchema: z.object({
        fromX: z.number().int(),
        fromY: z.number().int(),
        toX: z.number().int(),
        toY: z.number().int(),
      }),
      execute: async ({ fromX, fromY, toX, toY }) => {
        const computer = await getComputer()
        await computer.mouse.drag(fromX, fromY, toX, toY)
        return { draggedTo: { x: toX, y: toY } }
      },
    }),

    mouse_scroll: tool({
      description: "Scroll the mouse wheel at a point on your desktop.",
      inputSchema: z.object({
        x: z.number().int(),
        y: z.number().int(),
        direction: z.enum(["up", "down"]),
        amount: z.number().int().min(1).max(30).optional(),
      }),
      execute: async ({ x, y, direction, amount = 3 }) => {
        const computer = await getComputer()
        await computer.mouse.scroll(x, y, direction, amount)
        return { scrolled: direction, amount }
      },
    }),

    keyboard_type: tool({
      description:
        "Type text on your desktop, into whatever has focus. Newlines press Enter.",
      inputSchema: z.object({ text: z.string() }),
      execute: async ({ text }) => {
        const computer = await getComputer()
        await computer.keyboard.type(text)
        return { typed: text.length }
      },
    }),

    keyboard_press: tool({
      description:
        "Press a key on your desktop, optionally with modifiers. Keys: enter, escape, tab, backspace, delete, space, arrows (up, down, left, right), home, end, pageup, pagedown, f1-f24, letters and digits.",
      inputSchema: z.object({
        key: z.string(),
        modifiers: z.array(z.enum(["ctrl", "alt", "shift", "cmd"])).optional(),
      }),
      execute: async ({ key, modifiers }) => {
        const computer = await getComputer()
        await computer.keyboard.press(key, modifiers)
        return { pressed: [...(modifiers ?? []), key].join("+") }
      },
    }),

    // Sharing ------------------------------------------------------------------

    preview_url: tool({
      description:
        "Get a link the user can open for a web server running in your sandbox, such as one started with run_command. It works for an hour.",
      inputSchema: z.object({ port: z.number().int().min(1).max(65535) }),
      execute: async ({ port }) => {
        const sandbox = await getSandbox()
        const { url } = await sandbox.getSignedPreviewUrl(port, 3600)
        return { url, port }
      },
    }),

    // MCP servers ----------------------------------------------------------------

    mcp_list_tools: tool({
      description:
        "List the tools an MCP server offers, given its HTTP URL and any headers it needs.",
      inputSchema: z.object({
        url: z.url(),
        headers: z.record(z.string(), z.string()).optional(),
      }),
      execute: async ({ url, headers }) => {
        const client = await createMCPClient({
          transport: { type: "http", url, headers },
        })
        try {
          const { tools } = await client.listTools()
          return tools.map((item) => ({
            name: item.name,
            description: item.description,
            inputSchema: item.inputSchema,
          }))
        } finally {
          await client.close()
        }
      },
    }),

    mcp_call_tool: tool({
      description: "Call a tool on an MCP server, given its HTTP URL.",
      inputSchema: z.object({
        url: z.url(),
        headers: z.record(z.string(), z.string()).optional(),
        name: z.string(),
        arguments: z.record(z.string(), z.unknown()).optional(),
      }),
      execute: async ({ url, headers, name: toolName, arguments: args }) => {
        const client = await createMCPClient({
          transport: { type: "http", url, headers },
        })
        try {
          const result = await client.callTool({
            name: toolName,
            arguments: args,
          })
          // Too long to keep whole: the tail, as text.
          const json = JSON.stringify(result)
          return json.length > MAX_OUTPUT ? { truncated: clip(json) } : result
        } finally {
          await client.close()
        }
      },
    }),
  }
}

// A chat bot's sandbox tools. The bot is loaded, and its sandbox started,
// the first time a tool needs them. `botId` is the bot answering a turn or
// working on an assignment; without it, the chat's first bot (a direct
// chat's only one).
export function createChatBotTools(
  chatId: string,
  botId: string | undefined,
  owner: SandboxOwner = {}
) {
  let bot: ReturnType<typeof getChatBot> | undefined
  let sandbox: Promise<Sandbox> | undefined
  const getBot = () => (bot ??= getChatBot(chatId, botId))
  return createBotTools({
    owner,
    getBot,
    getSandbox: () => {
      sandbox ??= getBot()
        .then(({ sandboxId }) => {
          if (!sandboxId) throw new Error("You don't have a sandbox.")
          return getStartedSandbox(sandboxId, owner)
        })
        .catch((error) => {
          sandbox = undefined
          throw error
        })
      return sandbox
    },
  })
}
