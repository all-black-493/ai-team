"use client"

import { useState, type ReactNode } from "react"
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
  BrainIcon,
  CodeIcon,
  EyeIcon,
  FilePenIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderInputIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitPullRequestArrowIcon,
  GlobeIcon,
  ImageIcon,
  KeyboardIcon,
  LinkIcon,
  MonitorIcon,
  MousePointerClickIcon,
  MoveIcon,
  PlugIcon,
  ScrollTextIcon,
  SearchIcon,
  SquareIcon,
  TerminalIcon,
  TextSearchIcon,
  Trash2Icon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"

import { Image } from "@/components/ai-elements/image"
import { MessageResponse } from "@/components/ai-elements/message"
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
  // Shown when the row is opened, once there's output.
  detail?: (output: unknown, input: unknown) => string | undefined
  // Never opened: the output is for the bot only, like view_screen's image.
  hidden?: boolean
}

const commandOutput = (output: unknown) => field(output, "output") || undefined

const toolMeta: Record<string, ToolMeta> = {
  run_command: {
    icon: TerminalIcon,
    verbs: ["Running", "Ran", "Failed to run"],
    subject: (input) => shorten(field(input, "command")),
    detail: commandOutput,
  },
  read_process_logs: {
    icon: ScrollTextIcon,
    verbs: ["Reading", "Read", "Failed to read"],
    subject: () => "process logs",
    detail: commandOutput,
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
    <ToolDetail line={line} live={phase === "running"}>
      {detail}
    </ToolDetail>
  )
}

// Live output from a running command opens by itself. Whether it starts open
// is fixed when the row first has output: Base UI warns if an uncontrolled
// Collapsible's defaultOpen changes later.
function ToolDetail({
  line,
  live,
  children,
}: {
  line: ReactNode
  live: boolean
  children: string
}) {
  const [defaultOpen] = useState(live)
  return (
    <TraceCollapsible defaultOpen={defaultOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <CodeBlock size="sm">
          <CodeBlockContent wrap className="max-h-64">
            {children}
          </CodeBlockContent>
        </CodeBlock>
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
      run.push(<ToolRow key={key} part={part} streaming={streaming} />)
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
