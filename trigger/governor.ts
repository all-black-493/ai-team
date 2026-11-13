import type { ToolSet } from "ai"

import {
  loadLimits,
  recordEvent,
  recordUsage,
  spendOf,
} from "@/chats/budget-data"
import type { ChatEvent } from "@/db/schema"
import {
  budgetOf,
  describeScope,
  riskOf,
  SHELL_TOOLS,
  type ApprovalKind,
  type Limits,
} from "@/lib/budget"
import { MODERATION_ACTIONS } from "@/lib/governance"
import { recordSandboxCall } from "@/lib/sandbox"

// The limits one turn, or one bot's assignment within it, runs under. A
// turn and the bots it sets to work share what's left of the spend limits;
// each has its own clock, tool calls and shell commands.

export type StopReason = "spend" | "time" | "tools"

const STOP_TITLES: Record<StopReason, string> = {
  spend: "Stopped at the spend limit",
  time: "Stopped at the time limit",
  tools: "Stopped at the tool-call limit",
}

// Past the deadline, a step in flight gets this long to finish before the
// work is cut off.
const GRACE_MS = 60_000

type Meter = { remaining: number; spent: number }

export class Execution {
  tools = 0
  shell = 0
  // What this bot's own model calls cost, apart from bots it set to work.
  ownSpent = 0
  stopped: StopReason | undefined
  readonly deadline: number

  constructor(
    readonly context: {
      userId: string
      chatId: string
      botId: string
      sandboxId?: string | null
      limits: Limits
    },
    readonly meter: Meter,
    deadline = Infinity
  ) {
    this.deadline = Math.min(
      deadline,
      Date.now() + context.limits.maxTaskMinutes * 60_000
    )
  }

  // For a bot set to work by this one: the same spend, its own counts, and
  // no later deadline.
  child(botId: string, sandboxId?: string | null) {
    return new Execution(
      { ...this.context, botId, sandboxId },
      this.meter,
      this.deadline
    )
  }

  get limits() {
    return this.context.limits
  }

  private reason(): StopReason | undefined {
    if (this.meter.spent >= this.meter.remaining) return "spend"
    if (Date.now() >= this.deadline) return "time"
    if (this.tools >= this.limits.maxToolCalls) return "tools"
    return undefined
  }

  stopWhen = () => {
    const reason = this.reason()
    if (reason) this.stopped ??= reason
    return reason !== undefined
  }

  signal(signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(
      Math.max(0, this.deadline - Date.now()) + GRACE_MS
    )
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  async record(
    kind: "turn" | "work" | "ballot" | "director" | "summary",
    model: string,
    usage: Parameters<typeof recordUsage>[0]["usage"],
    botId: string | null = this.context.botId
  ) {
    const cost = await recordUsage({
      userId: this.context.userId,
      chatId: this.context.chatId,
      botId,
      kind,
      model,
      usage,
    })
    this.meter.spent += cost
    if (botId === this.context.botId) this.ownSpent += cost
    return cost
  }

  stopTitle() {
    return this.stopped && STOP_TITLES[this.stopped]
  }
}

// What a turn starts with: the user's limits, and what's left of the
// tightest spend limit. `budget` is null when one is already used up.
export async function startExecution(context: {
  userId: string
  chatId: string
  botId: string
  sandboxId?: string | null
}) {
  const [limits, spend] = await Promise.all([
    loadLimits(context.userId),
    spendOf(context.userId, context.chatId),
  ])
  const budget = budgetOf(limits, spend)
  return {
    budget,
    execution: new Execution(
      { ...context, limits },
      { remaining: budget.remaining, spent: 0 }
    ),
  }
}

// A spend limit crossed in a turn, for the timeline: past the warning
// threshold, or used up.
export async function recordCrossings(
  execution: Execution,
  before: ReturnType<typeof budgetOf>
) {
  const { userId, chatId, limits } = execution.context
  const after = budgetOf(limits, await spendOf(userId, chatId))
  for (const item of after.scopes) {
    const was = before.scopes.find((scope) => scope.scope === item.scope)
    if (!was || item.limit === null) continue
    const warnAt = limits.warnAtPercent / 100
    if (was.used < 1 && item.used >= 1) {
      await recordEvent({
        chatId,
        category: "spent",
        title: "Spend limit reached",
        detail: `${describeScope(item)}. Bots stop until you raise it.`,
      })
    } else if (was.used < warnAt && item.used >= warnAt) {
      await recordEvent({
        chatId,
        category: "spent",
        title: `Spend passed ${limits.warnAtPercent}%`,
        detail: describeScope(item),
      })
    }
  }
}

type Fields = Record<string, unknown>

const text = (value: unknown, key: string) => {
  const item = (value as Fields | undefined)?.[key]
  return typeof item === "string" || typeof item === "number"
    ? String(item)
    : ""
}

const host = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

type EventOf = (
  input: unknown,
  output: unknown
) => (Pick<ChatEvent, "category" | "title"> & { detail?: string }) | undefined

const EVENTS: Record<string, EventOf> = {
  add_group_member: (input) => ({
    category: "changed",
    title: `Added ${text(input, "name")} to the group`,
  }),
  remove_group_member: (input) => ({
    category: "changed",
    title: `Removed ${text(input, "name")} from the group`,
  }),
  rename_group: (input) => ({
    category: "changed",
    title: `Renamed the group to “${text(input, "name")}”`,
  }),
  create_role: (input) => ({
    category: "changed",
    title: `Created the ${text(input, "name")} role`,
  }),
  update_role: (input) => ({
    category: "changed",
    title: `Changed the ${text(input, "role")} role`,
  }),
  delete_role: (input) => ({
    category: "changed",
    title: `Deleted the ${text(input, "role")} role`,
  }),
  assign_role: (input) => ({
    category: "changed",
    title: `Made ${text(input, "bot")} ${text(input, "role")}`,
  }),
  set_constitution: () => ({
    category: "changed",
    title: "Amended the constitution",
  }),
  update_group_memory: () => ({
    category: "changed",
    title: "Updated the shared memory",
  }),
  propose_task: (input) => ({
    category: text(input, "assignee") ? "delegated" : "did",
    title: `Proposed “${text(input, "title")}”${text(input, "assignee") ? ` for ${text(input, "assignee")}` : ""}`,
  }),
  update_task: (input) => ({
    category: "did",
    title: `Marked task ${text(input, "task")} ${text(input, "status").replace("_", " ")}`,
  }),
  flag_message: (input) => ({
    category: "did",
    title: `Flagged message ${text(input, "message")}`,
    detail: text(input, "reason"),
  }),
  answer_flag: (input) => ({
    category: "did",
    title: "Answered a flag",
    detail: text(input, "explanation"),
  }),
  moderate: (input) => {
    const decision = text(input, "decision")
    return {
      category: "decided",
      title: `Decided the flag on ${text(input, "message")}: ${decision === "dismiss" ? "dismissed" : (MODERATION_ACTIONS[decision as keyof typeof MODERATION_ACTIONS] ?? decision).toLowerCase()}`,
      detail: text(input, "reason"),
    }
  },
  consult: (_input, output) => workEvent("Asked", output),
  delegate: (_input, output) => workEvent("Delegated to", output),
  write_file: (input) => ({
    category: "changed",
    title: `Wrote ${text(input, "path")}`,
  }),
  edit_file: (input) => ({
    category: "changed",
    title: `Edited ${text(input, "path")}`,
  }),
  move_path: (input) => ({
    category: "changed",
    title: `Moved ${text(input, "from")} to ${text(input, "to")}`,
  }),
  delete_path: (input) => ({
    category: "changed",
    title: `Deleted ${text(input, "path")}`,
  }),
  git_commit: (input) => ({
    category: "changed",
    title: `Committed “${text(input, "message").split("\n")[0]}”`,
  }),
  git_push: (input) => ({
    category: "changed",
    title: `Pushed ${text(input, "path")}`,
  }),
  run_command: (input) =>
    riskOf(text(input, "command"))
      ? {
          category: "changed",
          title: `Ran ${text(input, "command").slice(0, 120)}`,
        }
      : undefined,
  mcp_call_tool: (input) => ({
    category: "did",
    title: `Called ${text(input, "name")} on ${host(text(input, "url"))}`,
  }),
  preview_url: (input) => ({
    category: "did",
    title: `Shared a preview of port ${text(input, "port")}`,
  }),
}

function workEvent(verb: string, output: unknown) {
  const results =
    (output as { results?: { bot: string; status: string }[] } | undefined)
      ?.results ?? []
  const names = results.map((result) => result.bot)
  const unfinished = results.filter((result) => result.status !== "done")
  return {
    category: "delegated" as const,
    title: `${verb} ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "")}`,
    detail:
      unfinished.length > 0
        ? `${unfinished.map((result) => result.bot).join(", ")} didn't finish`
        : undefined,
  }
}

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  typeof value === "object" && value !== null && Symbol.asyncIterator in value

// Counts each call against the execution's limits, refuses one past them,
// and records what changed for the timeline.
export function governTools(tools: ToolSet, execution: Execution): ToolSet {
  const { limits, chatId, botId, userId } = execution.context
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const run = tool.execute
      if (!run) return [name, tool]
      return [
        name,
        {
          ...tool,
          execute: (input: unknown, options: Parameters<typeof run>[1]) => {
            if (execution.tools >= limits.maxToolCalls) {
              return Promise.reject(
                new Error(
                  `This turn has used its ${limits.maxToolCalls} tool calls. Stop, and say where you got to.`
                )
              )
            }
            if (SHELL_TOOLS.includes(name)) {
              if (execution.shell >= limits.maxShellCommands) {
                return Promise.reject(
                  new Error(
                    `This turn has used its ${limits.maxShellCommands} shell commands. Finish without more.`
                  )
                )
              }
              execution.shell += 1
            }
            execution.tools += 1
            const sandboxId = isSandboxTool(name)
              ? execution.context.sandboxId
              : undefined
            const started = Date.now()
            const settle = async (output: unknown, error?: unknown) => {
              if (sandboxId) {
                await recordSandboxCall(
                  sandboxId,
                  `tool:${name}`,
                  { userId, botId },
                  { ok: error === undefined, started, error }
                )
              }
              const event = error ? undefined : EVENTS[name]?.(input, output)
              if (event) await recordEvent({ chatId, botId, ...event })
            }
            const result = run(input as never, options)
            if (isAsyncIterable(result)) {
              return (async function* () {
                let last: unknown
                try {
                  for await (const value of result) {
                    last = value
                    yield value
                  }
                } catch (error) {
                  await settle(undefined, error)
                  throw error
                }
                await settle(last)
              })()
            }
            return Promise.resolve(result).then(
              async (output) => {
                await settle(output)
                return output
              },
              async (error) => {
                await settle(undefined, error)
                throw error
              }
            )
          },
        },
      ]
    })
  ) as ToolSet
}

// Which calls wait for the user's approval, under their settings. A bot
// working on an assignment can't wait for one, so it's refused instead.
export function approvalPolicy(limits: Limits, mode: "ask" | "refuse") {
  const gate = (kind: ApprovalKind, reason: string) => {
    if (!limits[kind]) return undefined
    return mode === "ask"
      ? { type: "user-approval" as const, reason }
      : {
          type: "denied" as const,
          reason: `${reason}: that needs the user's approval, which can't be asked for during an assignment. Leave it, and say in your report what needs doing.`,
        }
  }
  return ({ toolCall }: { toolCall: { toolName: string; input: unknown } }) => {
    const { toolName, input } = toolCall
    switch (toolName) {
      case "delete_path":
        return gate("approveFileDeletes", `Delete ${text(input, "path")}`)
      case "git_push":
        return gate("approveCodePushes", `Push ${text(input, "path")}`)
      case "run_command":
      case "run_code": {
        const source = text(input, toolName === "run_code" ? "code" : "command")
        const kind = riskOf(source)
        return kind && gate(kind, `Run ${source.slice(0, 200)}`)
      }
      case "create_role":
        return gate(
          "approveRoleChanges",
          `Create the ${text(input, "name")} role`
        )
      case "update_role":
        return gate(
          "approveRoleChanges",
          `Change the ${text(input, "role")} role`
        )
      case "delete_role":
        return gate(
          "approveRoleChanges",
          `Delete the ${text(input, "role")} role`
        )
      case "assign_role":
        return gate(
          "approveRoleChanges",
          `Make ${text(input, "bot")} ${text(input, "role")}`
        )
      case "mcp_call_tool":
        return gate(
          "approveIntegrations",
          `Call ${text(input, "name")} on ${host(text(input, "url"))}`
        )
      default:
        return undefined
    }
  }
}

const TOOL_GROUPS: [string, string[]][] = [
  [
    "group action",
    [
      "add_group_member",
      "remove_group_member",
      "rename_group",
      "create_role",
      "update_role",
      "delete_role",
      "assign_role",
      "set_constitution",
      "update_group_memory",
      "propose_task",
      "update_task",
      "flag_message",
      "answer_flag",
      "moderate",
      "consult",
      "delegate",
      "call_vote",
      "handoff",
    ],
  ],
  ["command", ["run_command", "run_code", "read_process_logs", "stop_process"]],
  [
    "file action",
    [
      "list_files",
      "read_file",
      "write_file",
      "edit_file",
      "find_files",
      "search_text",
      "move_path",
      "delete_path",
      "create_folder",
      "view_image",
    ],
  ],
  [
    "git action",
    [
      "git_clone",
      "git_status",
      "git_add",
      "git_commit",
      "git_branches",
      "git_checkout",
      "git_pull",
      "git_push",
    ],
  ],
  [
    "desktop action",
    [
      "view_screen",
      "show_screen",
      "mouse_click",
      "mouse_move",
      "mouse_drag",
      "mouse_scroll",
      "keyboard_type",
      "keyboard_press",
    ],
  ],
  ["knowledge search", ["search_knowledge"]],
]

// What a turn used its tools for, as in "4 commands, 2 file actions".
export function toolSummary(names: string[]) {
  if (names.length === 0) return null
  const counts = new Map<string, number>()
  for (const name of names) {
    const group =
      TOOL_GROUPS.find(([, members]) => members.includes(name))?.[0] ??
      "other tool call"
    counts.set(group, (counts.get(group) ?? 0) + 1)
  }
  return [...counts]
    .map(([group, count]) => `${count} ${group}${count === 1 ? "" : "s"}`)
    .join(", ")
}

const SANDBOX_TOOLS = new Set([
  ...TOOL_GROUPS.filter(
    ([group]) => group !== "group action" && group !== "knowledge search"
  ).flatMap(([, names]) => names),
  "preview_url",
  "mcp_list_tools",
  "mcp_call_tool",
  "code_symbols",
  "code_completions",
])

const isSandboxTool = (name: string) => SANDBOX_TOOLS.has(name)
