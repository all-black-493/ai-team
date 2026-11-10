"use client"

import { createContext, use, useState, type ReactNode } from "react"
import {
  getToolName,
  isToolUIPart,
  type DynamicToolUIPart,
  type ReasoningUIPart,
  type SourceUrlUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai"
import {
  ArrowUpRightIcon,
  BracesIcon,
  ClipboardListIcon,
  BrainIcon,
  CodeIcon,
  EyeIcon,
  FilePenIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderInputIcon,
  FolderOpenIcon,
  FlagIcon,
  FolderPlusIcon,
  ForwardIcon,
  GavelIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitPullRequestArrowIcon,
  GlobeIcon,
  ImageIcon,
  KeyboardIcon,
  LandmarkIcon,
  LinkIcon,
  ListChecksIcon,
  ListPlusIcon,
  MonitorIcon,
  MousePointerClickIcon,
  MoveIcon,
  NotebookPenIcon,
  PencilIcon,
  PlugIcon,
  ScaleIcon,
  ScrollTextIcon,
  SearchIcon,
  ShieldIcon,
  ShieldMinusIcon,
  ShieldPlusIcon,
  SquareIcon,
  TerminalIcon,
  TextSearchIcon,
  Trash2Icon,
  UserCogIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersIcon,
  VoteIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"

import { Image } from "@/components/ai-elements/image"
import { MessageResponse } from "@/components/ai-elements/message"
import { Shimmer } from "@/components/ai-elements/shimmer"
import { ChatAvatar } from "@/components/chat-avatar"
import { Badge } from "@/components/ui/badge"
import {
  CONSULT_TOOL,
  DELEGATE_TOOL,
  PARALLEL_TOOLS,
  tally,
  VOTE_TOOL,
  workKey,
  type ParallelOutput,
  type VoteOutput,
  type WorkResult,
} from "@/chats/collaboration"
import { MODERATION_ACTIONS, PERMISSIONS } from "@/lib/governance"
import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalTitle,
} from "@/components/ai-elements/terminal"
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace"

type ToolPart = ToolUIPart | DynamicToolUIPart
type Phase = "running" | "done" | "failed"
type Fields = Record<string, unknown>

type ActivityBot = { id: string; name: string; avatar: string }

// What a group's activity needs from the chat: its bots, for their faces,
// and the live answer of each bot at work in a consult or delegate call,
// by workKey, while it streams in.
const ActivityContext = createContext<{
  bots: ActivityBot[]
  work: (key: string) => UIMessage | undefined
}>({ bots: [], work: () => undefined })

export function ChatActivityProvider({
  bots,
  work,
  children,
}: {
  bots: ActivityBot[]
  work: (key: string) => UIMessage | undefined
  children: ReactNode
}) {
  return <ActivityContext value={{ bots, work }}>{children}</ActivityContext>
}

// A bot by ID, or failing that by name; one that has left keeps a face.
function useFace() {
  const { bots } = use(ActivityContext)
  return (botId: string | undefined, name: string) =>
    bots.find((bot) => bot.id === botId) ??
    bots.find(
      (bot) => bot.name.toLowerCase() === name.trim().toLowerCase()
    ) ?? {
      id: botId ?? name,
      name,
      avatar: botId ?? name,
    }
}

const listOf = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`

// A field of a tool's input or output, as text.
function field(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) return undefined
  const item = (value as Fields)[key]
  return typeof item === "string" || typeof item === "number"
    ? String(item)
    : undefined
}

function shorten(text: string | undefined, max = 60) {
  if (!text) return undefined
  const line = text.split("\n")[0]
  return line.length > max || line !== text ? `${line.slice(0, max)}…` : line
}

function host(url: string | undefined) {
  try {
    return url ? new URL(url).host : undefined
  } catch {
    return url
  }
}

function json(value: unknown) {
  return JSON.stringify(value, null, 2)
}

// What each tool's row says and shows. The three verbs agree with the line's
// status: running, done and failed.
type ToolMeta = {
  icon: LucideIcon
  verbs: [string, string, string]
  subject?: (input: unknown) => string | undefined
  // A note beside the title, such as why.
  description?: (input: unknown) => string | undefined
  // Shown when the row is opened, once there's output.
  detail?: (output: unknown, input: unknown) => string | undefined
  // The detail is a terminal's output, colors and all.
  terminal?: boolean
  // Never opened: the output is for the bot only, like view_screen's image.
  hidden?: boolean
}

const commandOutput = (output: unknown) => field(output, "output") || undefined

// A role's permissions, one per line, as the user reads them.
function permissionList(input: unknown) {
  const permissions = (input as { permissions?: string[] } | undefined)
    ?.permissions
  return permissions
    ?.map(
      (permission) =>
        PERMISSIONS[permission as keyof typeof PERMISSIONS] ?? permission
    )
    .join("\n")
}

const toolMeta: Record<string, ToolMeta> = {
  run_command: {
    icon: TerminalIcon,
    verbs: ["Running", "Ran", "Failed to run"],
    subject: (input) => shorten(field(input, "command")),
    detail: commandOutput,
    terminal: true,
  },
  read_process_logs: {
    icon: ScrollTextIcon,
    verbs: ["Reading", "Read", "Failed to read"],
    subject: () => "process logs",
    detail: commandOutput,
    terminal: true,
  },
  stop_process: {
    icon: SquareIcon,
    verbs: ["Stopping", "Stopped", "Failed to stop"],
    subject: () => "a process",
  },
  run_code: {
    icon: CodeIcon,
    verbs: ["Running", "Ran", "Failed to run"],
    subject: () => "Python code",
    detail: (output, input) =>
      [field(input, "code"), field(output, "output")]
        .filter(Boolean)
        .join("\n\n# Output\n"),
  },
  list_files: {
    icon: FolderOpenIcon,
    verbs: ["Listing", "Listed", "Failed to list"],
    subject: (input) => field(input, "path"),
    detail: (output) =>
      Array.isArray(output)
        ? output
            .map((file: Fields) =>
              file.isDir ? `${file.name}/` : String(file.name)
            )
            .join("\n")
        : undefined,
  },
  read_file: {
    icon: FileTextIcon,
    verbs: ["Reading", "Read", "Failed to read"],
    subject: (input) => field(input, "path"),
    detail: (output) => field(output, "content"),
  },
  write_file: {
    icon: FilePlusIcon,
    verbs: ["Writing", "Wrote", "Failed to write"],
    subject: (input) => field(input, "path"),
    detail: (_output, input) => field(input, "content"),
  },
  edit_file: {
    icon: FilePenIcon,
    verbs: ["Editing", "Edited", "Failed to edit"],
    subject: (input) => field(input, "path"),
    detail: (_output, input) =>
      [
        ...(field(input, "oldText") ?? "").split("\n").map((l) => `- ${l}`),
        ...(field(input, "newText") ?? "").split("\n").map((l) => `+ ${l}`),
      ].join("\n"),
  },
  find_files: {
    icon: SearchIcon,
    verbs: ["Finding", "Found", "Failed to find"],
    subject: (input) => field(input, "pattern"),
    detail: (output) => {
      const files = (output as { files?: string[] } | undefined)?.files
      return files?.length ? files.join("\n") : "No files"
    },
  },
  search_text: {
    icon: TextSearchIcon,
    verbs: ["Searching for", "Searched for", "Failed to search for"],
    subject: (input) => field(input, "pattern"),
    detail: (output) =>
      Array.isArray(output) && output.length
        ? output
            .map((m: Fields) => `${m.file}:${m.line}: ${m.content}`)
            .join("\n")
        : "No matches",
  },
  move_path: {
    icon: FolderInputIcon,
    verbs: ["Moving", "Moved", "Failed to move"],
    subject: (input) => `${field(input, "from")} to ${field(input, "to")}`,
  },
  delete_path: {
    icon: Trash2Icon,
    verbs: ["Deleting", "Deleted", "Failed to delete"],
    subject: (input) => field(input, "path"),
  },
  create_folder: {
    icon: FolderPlusIcon,
    verbs: ["Creating", "Created", "Failed to create"],
    subject: (input) => field(input, "path"),
  },
  view_image: {
    icon: ImageIcon,
    verbs: ["Looking at", "Looked at", "Failed to open"],
    subject: (input) => field(input, "path"),
    hidden: true,
  },
  git_clone: {
    icon: GitBranchIcon,
    verbs: ["Cloning", "Cloned", "Failed to clone"],
    subject: (input) => field(input, "url"),
  },
  git_status: {
    icon: GitBranchIcon,
    verbs: ["Checking", "Checked", "Failed to check"],
    subject: (input) => `git status of ${field(input, "path")}`,
    detail: json,
  },
  git_add: {
    icon: GitCommitIcon,
    verbs: ["Staging", "Staged", "Failed to stage"],
    subject: (input) => `changes in ${field(input, "path")}`,
  },
  git_commit: {
    icon: GitCommitIcon,
    verbs: ["Committing", "Committed", "Failed to commit"],
    subject: (input) => shorten(field(input, "message")),
  },
  git_branches: {
    icon: GitBranchIcon,
    verbs: ["Listing", "Listed", "Failed to list"],
    subject: () => "branches",
    detail: json,
  },
  git_checkout: {
    icon: GitBranchIcon,
    verbs: ["Switching to", "Switched to", "Failed to switch to"],
    subject: (input) => field(input, "branch"),
  },
  git_pull: {
    icon: GitPullRequestArrowIcon,
    verbs: ["Pulling", "Pulled", "Failed to pull"],
    subject: (input) => field(input, "path"),
  },
  git_push: {
    icon: GitPullRequestArrowIcon,
    verbs: ["Pushing", "Pushed", "Failed to push"],
    subject: (input) => field(input, "path"),
  },
  code_symbols: {
    icon: BracesIcon,
    verbs: ["Finding", "Found", "Failed to find"],
    subject: (input) =>
      `symbols in ${field(input, "filePath") ?? field(input, "projectPath")}`,
    detail: json,
  },
  code_completions: {
    icon: BracesIcon,
    verbs: ["Getting", "Got", "Failed to get"],
    subject: (input) => `completions in ${field(input, "filePath")}`,
    detail: json,
  },
  view_screen: {
    icon: EyeIcon,
    verbs: ["Looking at", "Looked at", "Failed to look at"],
    subject: () => "the screen",
    hidden: true,
  },
  show_screen: {
    icon: MonitorIcon,
    verbs: ["Taking", "Took", "Failed to take"],
    subject: () => "a screenshot",
  },
  mouse_click: {
    icon: MousePointerClickIcon,
    verbs: ["Clicking", "Clicked", "Failed to click"],
    subject: (input) => `at ${field(input, "x")}, ${field(input, "y")}`,
  },
  mouse_move: {
    icon: MoveIcon,
    verbs: ["Moving", "Moved", "Failed to move"],
    subject: (input) =>
      `the mouse to ${field(input, "x")}, ${field(input, "y")}`,
  },
  mouse_drag: {
    icon: MoveIcon,
    verbs: ["Dragging", "Dragged", "Failed to drag"],
    subject: (input) => `to ${field(input, "toX")}, ${field(input, "toY")}`,
  },
  mouse_scroll: {
    icon: MoveIcon,
    verbs: ["Scrolling", "Scrolled", "Failed to scroll"],
    subject: (input) => field(input, "direction"),
  },
  keyboard_type: {
    icon: KeyboardIcon,
    verbs: ["Typing", "Typed", "Failed to type"],
    subject: (input) => {
      const text = shorten(field(input, "text"), 40)
      return text && `“${text}”`
    },
  },
  keyboard_press: {
    icon: KeyboardIcon,
    verbs: ["Pressing", "Pressed", "Failed to press"],
    subject: (input) => {
      const modifiers = (input as { modifiers?: string[] })?.modifiers ?? []
      const key = field(input, "key")
      return key && [...modifiers, key].join("+")
    },
  },
  preview_url: {
    icon: LinkIcon,
    verbs: ["Sharing", "Shared", "Failed to share"],
    subject: (input) => `port ${field(input, "port")}`,
  },
  mcp_list_tools: {
    icon: PlugIcon,
    verbs: ["Listing", "Listed", "Failed to list"],
    subject: (input) => `tools on ${host(field(input, "url"))}`,
    detail: (output) =>
      Array.isArray(output)
        ? output
            .map((item: Fields) =>
              item.description
                ? `${item.name}: ${item.description}`
                : String(item.name)
            )
            .join("\n")
        : undefined,
  },
  // In a group chat: the user's message goes to another bot, who answers it
  // next.
  handoff: {
    icon: ForwardIcon,
    verbs: ["Handing off to", "Handed off to", "Couldn't hand off to"],
    subject: (input) => field(input, "to"),
    description: (input) => shorten(field(input, "reason"), 80),
  },
  // An admin bot changing its group chat.
  add_group_member: {
    icon: UserPlusIcon,
    verbs: ["Adding", "Added", "Couldn't add"],
    subject: (input) => `${field(input, "name")} to the group`,
  },
  remove_group_member: {
    icon: UserMinusIcon,
    verbs: ["Removing", "Removed", "Couldn't remove"],
    subject: (input) => `${field(input, "name")} from the group`,
  },
  rename_group: {
    icon: PencilIcon,
    verbs: ["Renaming", "Renamed", "Couldn't rename"],
    subject: (input) => `the group to “${field(input, "name")}”`,
  },
  // A group governing itself (trigger/group-tools.ts).
  create_role: {
    icon: ShieldPlusIcon,
    verbs: ["Creating", "Created", "Couldn't create"],
    subject: (input) => `the ${field(input, "name")} role`,
    detail: (_output, input) => permissionList(input),
  },
  update_role: {
    icon: ShieldIcon,
    verbs: ["Changing", "Changed", "Couldn't change"],
    subject: (input) => `the ${field(input, "role")} role`,
    detail: (_output, input) => permissionList(input),
  },
  delete_role: {
    icon: ShieldMinusIcon,
    verbs: ["Deleting", "Deleted", "Couldn't delete"],
    subject: (input) => `the ${field(input, "role")} role`,
  },
  assign_role: {
    icon: UserCogIcon,
    verbs: ["Making", "Made", "Couldn't make"],
    subject: (input) => `${field(input, "bot")} ${field(input, "role")}`,
  },
  set_constitution: {
    icon: LandmarkIcon,
    verbs: ["Writing", "Wrote", "Couldn't write"],
    subject: () => "the constitution",
    detail: (_output, input) => field(input, "text"),
  },
  // Only that it changed: the shared memory is for the bots, not the page.
  update_group_memory: {
    icon: NotebookPenIcon,
    verbs: ["Updating", "Updated", "Couldn't update"],
    subject: () => "the shared memory",
  },
  propose_task: {
    icon: ListPlusIcon,
    verbs: ["Proposing", "Proposed", "Couldn't propose"],
    subject: (input) => `“${shorten(field(input, "title"), 50)}”`,
    description: (input) =>
      field(input, "assignee") && `for ${field(input, "assignee")}`,
  },
  update_task: {
    icon: ListChecksIcon,
    verbs: ["Updating", "Updated", "Couldn't update"],
    subject: (input) => `task ${field(input, "task")}`,
    description: (input) => field(input, "status")?.replace("_", " "),
  },
  flag_message: {
    icon: FlagIcon,
    verbs: ["Flagging", "Flagged", "Couldn't flag"],
    subject: (input) => `message ${field(input, "message")}`,
    description: (input) => shorten(field(input, "reason"), 80),
  },
  answer_flag: {
    icon: ScaleIcon,
    verbs: ["Answering", "Answered", "Couldn't answer"],
    subject: () => "the flag",
    detail: (_output, input) =>
      [
        ["Explanation", field(input, "explanation")],
        ["Challenge", field(input, "challenge")],
        ["Evidence", field(input, "evidence")],
        ["Request", field(input, "request")],
      ]
        .filter(([, text]) => text)
        .map(([label, text]) => `${label}: ${text}`)
        .join("\n\n"),
  },
  // A bot working on a delegated task says whether it's done.
  finish_task: {
    icon: ListChecksIcon,
    verbs: ["Reporting on", "Reported on", "Couldn't report on"],
    subject: () => "the task",
    description: (input) =>
      (input as { done?: boolean } | undefined)?.done ? "Done" : "Not done yet",
    detail: (_output, input) => field(input, "summary"),
  },
  moderate: {
    icon: GavelIcon,
    verbs: ["Deciding", "Decided", "Couldn't decide"],
    subject: (input) => `the flag on ${field(input, "message")}`,
    description: (input) => {
      const decision = field(input, "decision")
      return decision === "dismiss"
        ? "Dismissed"
        : (MODERATION_ACTIONS[decision as keyof typeof MODERATION_ACTIONS] ??
            decision)
    },
    detail: (_output, input) => field(input, "reason"),
  },
  mcp_call_tool: {
    icon: PlugIcon,
    verbs: ["Calling", "Called", "Failed to call"],
    subject: (input) =>
      `${field(input, "name")} on ${host(field(input, "url"))}`,
    detail: json,
  },
}

const fallbackMeta: ToolMeta = {
  icon: WrenchIcon,
  verbs: ["Running", "Ran", "Failed to run"],
  detail: json,
}

// The SDK's tool states, mapped to the line's. A call that never finished in
// a message that has (the user stopped it) counts as failed.
function phaseOf(part: ToolPart, streaming: boolean): Phase {
  if (part.state === "output-error" || part.state === "output-denied") {
    return "failed"
  }
  if (part.state === "output-available" && !part.preliminary) return "done"
  return streaming ? "running" : "failed"
}

function ToolRow({ part, streaming }: { part: ToolPart; streaming: boolean }) {
  const name = getToolName(part)
  const meta = toolMeta[name] ?? { ...fallbackMeta, subject: () => name }
  const phase = phaseOf(part, streaming)
  // Cut off before it finished, whether or not output had started.
  const stopped =
    phase === "failed" &&
    part.state !== "output-error" &&
    part.state !== "output-denied"
  const verb = meta.verbs[phase === "running" ? 0 : phase === "done" ? 1 : 2]
  const subject = meta.subject?.(part.input)
  const description = meta.description?.(part.input)
  const exitCode = field(part.output, "exitCode")
  const background =
    field(part.output, "status") === "running" && phase === "done"

  const line = (
    <TraceLine
      status={
        phase === "running"
          ? "running"
          : phase === "failed"
            ? "error"
            : undefined
      }
    >
      <TraceIcon>
        <meta.icon />
      </TraceIcon>
      <TraceTitle>{subject ? `${verb} ${subject}` : verb}</TraceTitle>
      {description && <TraceDescription>{description}</TraceDescription>}
      {background && <TraceDescription>In the background</TraceDescription>}
      {exitCode !== undefined && exitCode !== "0" && (
        <TraceDescription>Exit code {exitCode}</TraceDescription>
      )}
      {stopped && <TraceDescription>Stopped</TraceDescription>}
    </TraceLine>
  )

  // A shared link opens in a new tab.
  const url = field(part.output, "url")
  if (name === "preview_url" && url && phase === "done") {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <TraceLine>
          <TraceIcon>
            <meta.icon />
          </TraceIcon>
          <TraceTitle>
            {`${verb} ${subject}`}
            <span className="sr-only"> (opens in a new tab)</span>
          </TraceTitle>
          <TraceIcon>
            <ArrowUpRightIcon />
          </TraceIcon>
        </TraceLine>
      </a>
    )
  }

  const detail =
    part.state === "output-error"
      ? part.errorText
      : part.output !== undefined && !meta.hidden
        ? meta.detail?.(part.output, part.input)
        : undefined
  if (!detail) return line

  return (
    <ToolDetail
      line={line}
      live={phase === "running"}
      terminal={meta.terminal && part.state !== "output-error"}
    >
      {detail}
    </ToolDetail>
  )
}

// Bots set to work at once by a consult or delegate call: a line for the
// call, then one for each bot, which opens on its answer, live while it
// works. A bot's answer, once it's done, is kept with the call's output.
function ParallelWork({
  part,
  streaming,
}: {
  part: ToolPart
  streaming: boolean
}) {
  const { work } = use(ActivityContext)
  const face = useFace()
  const name = getToolName(part)
  const phase = phaseOf(part, streaming)
  const input = part.input as
    | {
        asks?: { bot?: string; request?: string }[]
        tasks?: { to?: string; title?: string }[]
      }
    | undefined
  const asked =
    name === CONSULT_TOOL
      ? (input?.asks ?? []).map((ask) => ({
          bot: ask?.bot ?? "",
          request: ask?.request ?? "",
        }))
      : (input?.tasks ?? []).map((task) => ({
          bot: task?.to ?? "",
          request: task?.title ?? "",
        }))
  const results =
    part.state === "output-available"
      ? (part.output as ParallelOutput | undefined)?.results
      : undefined
  const verbs =
    name === DELEGATE_TOOL
      ? ["Delegating to", "Delegated to", "Couldn't delegate to"]
      : ["Asking", "Asked", "Couldn't ask"]
  const verb = verbs[phase === "running" ? 0 : phase === "done" ? 1 : 2]
  const who = listOf(asked.map((ask) => ask.bot).filter(Boolean))

  const line = (
    <TraceLine
      status={
        phase === "running"
          ? "running"
          : phase === "failed"
            ? "error"
            : undefined
      }
    >
      <TraceIcon>
        {name === DELEGATE_TOOL ? <ClipboardListIcon /> : <UsersIcon />}
      </TraceIcon>
      <TraceTitle>{who ? `${verb} ${who}` : verb.split(" ")[0]}</TraceTitle>
      {asked.length > 1 && <TraceDescription>At once</TraceDescription>}
    </TraceLine>
  )
  if (part.state === "output-error") {
    return (
      <ToolDetail line={line} live={false}>
        {part.errorText}
      </ToolDetail>
    )
  }

  return (
    <>
      {line}
      {asked.map((ask, index) => (
        <WorkLine
          key={index}
          ask={ask}
          result={results?.[index]}
          live={work(workKey(part.toolCallId, index))}
          running={phase === "running"}
          face={face}
        />
      ))}
    </>
  )
}

// What a bot's line says about how its work went.
function workStatus(result: WorkResult | undefined, running: boolean) {
  if (!result) return running ? "Working" : "Stopped"
  if (result.status === "failed") return "Couldn't finish"
  if (result.status === "stopped") return "Stopped"
  if (result.taskId) return result.taskDone ? "Task done" : "Task not done"
  return "Done"
}

function WorkLine({
  ask,
  result,
  live,
  running,
  face,
}: {
  ask: { bot: string; request: string }
  result: WorkResult | undefined
  live: UIMessage | undefined
  running: boolean
  face: ReturnType<typeof useFace>
}) {
  const working = running && !result
  const message = live ?? result?.message
  const botId =
    result?.botId ??
    (message?.metadata as { botId?: string } | undefined)?.botId
  const bot = face(botId, result?.bot ?? ask.bot)
  const status = workStatus(result, running)
  // Opens on the work as it happens; afterwards, it's there on a click.
  const [defaultOpen] = useState(working)

  return (
    <TraceCollapsible defaultOpen={defaultOpen} className="pl-6">
      <TraceCollapsibleTrigger>
        <TraceLine
          status={
            working
              ? "running"
              : result && result.status !== "done"
                ? "error"
                : undefined
          }
        >
          <TraceIcon>
            <ChatAvatar seed={bot.avatar} className="size-4 rounded-sm" />
          </TraceIcon>
          <TraceTitle>
            {bot.name}
            {ask.request && `: ${shorten(ask.request, 60)}`}
          </TraceTitle>
          <TraceDescription>{status}</TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        {message && hasVisibleParts(message) ? (
          <AssistantParts message={message} streaming={working} />
        ) : working ? (
          <Shimmer>Working…</Shimmer>
        ) : (
          result?.report && <MessageResponse>{result.report}</MessageResponse>
        )}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

// A vote: its question and, as ballots come in, the count and each bot's
// choice and reason. Open while the bots vote.
function VoteRow({ part, streaming }: { part: ToolPart; streaming: boolean }) {
  const face = useFace()
  const phase = phaseOf(part, streaming)
  const input = part.input as { question?: string } | undefined
  const vote =
    part.state === "output-available"
      ? (part.output as VoteOutput | undefined)
      : undefined
  const question = vote?.question ?? input?.question
  const verb =
    phase === "running"
      ? "Calling a vote"
      : phase === "done"
        ? "Called a vote"
        : "Couldn't call a vote"
  const description = !vote
    ? undefined
    : vote.decided
      ? vote.outcome
        ? `Decided: ${vote.outcome}`
        : "Tied"
      : `${vote.ballots.length} of ${vote.ballots.length + vote.waiting.length} voted`
  const [defaultOpen] = useState(phase === "running")

  const line = (
    <TraceLine
      status={
        phase === "running"
          ? "running"
          : phase === "failed"
            ? "error"
            : undefined
      }
    >
      <TraceIcon>
        <VoteIcon />
      </TraceIcon>
      <TraceTitle>
        {question ? `${verb} on “${shorten(question, 70)}”` : verb}
      </TraceTitle>
      {description && <TraceDescription>{description}</TraceDescription>}
    </TraceLine>
  )
  if (part.state === "output-error") {
    return (
      <ToolDetail line={line} live={false}>
        {part.errorText}
      </ToolDetail>
    )
  }
  if (!vote) return line

  return (
    <TraceCollapsible defaultOpen={defaultOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {tally(vote.options, vote.ballots).map(({ option, votes }) => (
            <Badge
              key={option}
              variant={
                vote.decided && option === vote.outcome ? "default" : "outline"
              }
            >
              {option} · {votes}
            </Badge>
          ))}
        </div>
        <ul className="flex flex-col gap-2">
          {vote.ballots.map((ballot) => {
            const bot = face(ballot.botId, ballot.bot)
            return (
              <li key={ballot.botId} className="flex items-start gap-2 text-sm">
                <ChatAvatar
                  seed={bot.avatar}
                  className="mt-0.5 size-4 shrink-0 rounded-sm"
                />
                <span>
                  <span className="font-mono text-xs text-accent-foreground">
                    {bot.name}
                  </span>{" "}
                  {ballot.choice}. {ballot.reason}
                </span>
              </li>
            )
          })}
          {vote.waiting.length > 0 && (
            <li className="text-sm">
              <Shimmer>{`Waiting for ${listOf(vote.waiting)}…`}</Shimmer>
            </li>
          )}
        </ul>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

// Live output from a running command opens by itself. Whether it starts open
// is fixed when the row first has output: Base UI warns if an uncontrolled
// Collapsible's defaultOpen changes later.
function ToolDetail({
  line,
  live,
  terminal,
  children,
}: {
  line: ReactNode
  live: boolean
  terminal?: boolean
  children: string
}) {
  const [defaultOpen] = useState(live)
  return (
    <TraceCollapsible defaultOpen={defaultOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        {terminal ? (
          // Command output often carries ANSI colors, which the terminal
          // shows rather than printing their escape codes.
          <Terminal output={children} isStreaming={live}>
            <TerminalHeader className="py-1.5">
              <TerminalTitle>Output</TerminalTitle>
              <TerminalActions>
                <TerminalCopyButton />
              </TerminalActions>
            </TerminalHeader>
            <TerminalContent className="max-h-64 p-3 text-xs" />
          </Terminal>
        ) : (
          <CodeBlock size="sm">
            <CodeBlockContent wrap className="max-h-64">
              {children}
            </CodeBlockContent>
          </CodeBlock>
        )}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

function ReasoningRow({ part }: { part: ReasoningUIPart }) {
  const running = part.state === "streaming"
  const line = (
    <TraceLine status={running ? "running" : undefined}>
      <TraceIcon>
        <BrainIcon />
      </TraceIcon>
      <TraceTitle>{running ? "Thinking" : "Thought"}</TraceTitle>
    </TraceLine>
  )
  if (!part.text) return line
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">
          {part.text}
        </p>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

function SourceRow({ part }: { part: SourceUrlUIPart }) {
  return (
    <a href={part.url} target="_blank" rel="noreferrer">
      <TraceLine>
        <TraceIcon>
          <GlobeIcon />
        </TraceIcon>
        <TraceTitle>
          {part.title ?? host(part.url)}
          <span className="sr-only"> (opens in a new tab)</span>
        </TraceTitle>
        <TraceIcon>
          <ArrowUpRightIcon />
        </TraceIcon>
      </TraceLine>
    </a>
  )
}

// Between steps, after a tool has finished, the bot is thinking again.
function ThinkingRow() {
  return (
    <TraceLine status="running">
      <TraceIcon>
        <BrainIcon />
      </TraceIcon>
      <TraceTitle>Thinking</TraceTitle>
    </TraceLine>
  )
}

// Whether a message has anything to show yet.
export function hasVisibleParts(message: UIMessage) {
  return message.parts.some(
    (part) =>
      (part.type === "text" && part.text.length > 0) ||
      part.type === "reasoning" ||
      part.type === "source-url" ||
      isToolUIPart(part)
  )
}

// A bot's answer: text in order with what it did. Each run of activity
// between text is one Trace (DESIGN.md, shadcn chat rules), and a screenshot
// shown to the user sits in the answer like text does.
export function AssistantParts({
  message,
  streaming,
}: {
  message: UIMessage
  streaming: boolean
}) {
  const blocks: ReactNode[] = []
  let run: ReactNode[] = []
  const flush = (key: string) => {
    if (run.length === 0) return
    blocks.push(<Trace key={`trace-${key}`}>{run}</Trace>)
    run = []
  }

  message.parts.forEach((part, index) => {
    const key = `${message.id}-${index}`
    if (part.type === "text") {
      if (!part.text) return
      flush(key)
      blocks.push(
        <MessageResponse key={key} isAnimating={part.state === "streaming"}>
          {part.text}
        </MessageResponse>
      )
    } else if (part.type === "reasoning") {
      run.push(<ReasoningRow key={key} part={part} />)
    } else if (part.type === "source-url") {
      run.push(<SourceRow key={key} part={part} />)
    } else if (isToolUIPart(part)) {
      const output =
        part.state === "output-available" && !part.preliminary
          ? part.output
          : null
      const screenshot = getToolName(part) === "show_screen" && output
      if (screenshot) {
        flush(key)
        blocks.push(
          <Image
            key={key}
            base64={field(output, "data") ?? ""}
            mediaType={field(output, "mediaType") ?? "image/jpeg"}
            uint8Array={new Uint8Array()}
            alt="The bot's screen"
            className="rounded-lg border"
          />
        )
        return
      }
      const name = getToolName(part)
      if (PARALLEL_TOOLS.includes(name)) {
        run.push(<ParallelWork key={key} part={part} streaming={streaming} />)
      } else if (name === VOTE_TOOL) {
        run.push(<VoteRow key={key} part={part} streaming={streaming} />)
      } else {
        run.push(<ToolRow key={key} part={part} streaming={streaming} />)
      }
    }
  })

  const last = message.parts.findLast((part) => part.type !== "step-start")
  if (
    streaming &&
    last &&
    isToolUIPart(last) &&
    phaseOf(last, streaming) !== "running"
  ) {
    run.push(<ThinkingRow key="thinking" />)
  }
  flush("end")
  return blocks
}
