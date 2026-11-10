import {
  convertToModelMessages,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolSet,
  type UIMessage,
  type UserContent,
} from "ai"

import { collaborationOf } from "@/chats/collaboration"
import { handoffOf } from "@/chats/handoff"
import { messageRef } from "@/lib/governance"

// What a bot reads of a chat: the model's copy of the conversation, built
// from the stored messages each turn. The stored messages stay as they were.

// What the chat's messages carry. On an answer: the bot that wrote it and the
// model it ran on, set as it starts, then token usage for the context meter
// (how big the conversation was at the answer's last step, and what the whole
// turn used). On the user's message in a group: the message it replies to.
export type BotMessageMetadata = {
  botId?: string
  model?: string
  contextTokens?: number
  usage?: LanguageModelUsage
  replyTo?: string
}

export type BotUIMessage = UIMessage<BotMessageMetadata>

// Screenshots cost the model about a thousand tokens each, and computer use
// takes many. Older ones are dropped from what it sees.
const KEEP_SCREENSHOTS = 3

// How much of a replied-to message the bot is shown, in characters.
const REPLY_SNIPPET = 200
// And of another bot's answer: enough to build on, short of a whole report.
const ANSWER_QUOTE = 4000
// And of each report another bot got back from bots working for it.
const REPORT_QUOTE = 600

export function textOf(message: UIMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim()
}

export const metadataOf = (message: UIMessage) =>
  message.metadata as BotMessageMetadata | undefined

const clipped = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text

// What the model sees each turn: attachments become notes about where they
// are in the sandbox (the chat only carries a sandbox: URL, never the file),
// and only the latest few screenshots from earlier turns stay as images.
export function prepareContext(messages: ModelMessage[]): ModelMessage[] {
  let screenshots = 0
  return messages
    .toReversed()
    .map((message): ModelMessage => {
      if (message.role === "user" && Array.isArray(message.content)) {
        return {
          ...message,
          content: message.content.map((part) => {
            const path = part.type === "file" ? sandboxPath(part.data) : null
            if (part.type !== "file" || path === null) return part
            return {
              type: "text" as const,
              text: `[The user attached ${part.filename ?? "a file"} (${part.mediaType}). It's saved in your sandbox at ${path}]`,
            }
          }),
        }
      }
      if (message.role === "tool") {
        return {
          ...message,
          content: message.content.map((part) => {
            if (
              part.type !== "tool-result" ||
              part.output.type !== "content" ||
              !part.output.value.some((item) => item.type === "file")
            ) {
              return part
            }
            screenshots += 1
            if (screenshots <= KEEP_SCREENSHOTS) return part
            return {
              ...part,
              output: {
                type: "text" as const,
                value: "[An earlier image, no longer shown]",
              },
            }
          }),
        }
      }
      return message
    })
    .toReversed()
}

// The path in a sandbox: file reference, or null for any other file.
function sandboxPath(data: unknown) {
  const url =
    data instanceof URL
      ? data.href
      : typeof data === "string"
        ? data
        : typeof data === "object" &&
            data !== null &&
            "type" in data &&
            data.type === "url" &&
            "url" in data &&
            data.url instanceof URL
          ? data.url.href
          : null
  return url?.startsWith("sandbox:") ? url.slice("sandbox:".length) : null
}

// What a bot's answer did beyond its text, in words for the other bots:
// whom it handed the message to, which bots worked for it and what they
// reported, and the votes it called.
function deedsOf(message: UIMessage) {
  const deeds: string[] = []
  const handoff = handoffOf(message)
  if (handoff) {
    deeds.push(`handed the message to ${handoff.name}: ${handoff.reason}`)
  }
  const { work, votes } = collaborationOf(message)
  for (const { results } of work) {
    const reports = results.map(
      (result) =>
        `${result.bot} ${result.status === "done" ? "reported" : "couldn't finish"}: "${clipped(result.report, REPORT_QUOTE)}"`
    )
    deeds.push(
      `had ${results.map((result) => result.bot).join(" and ")} work at once (${reports.join("; ")})`
    )
  }
  for (const vote of votes) {
    const result = vote.outcome
      ? `the group decided "${vote.outcome}"`
      : "it was tied, so nothing was decided"
    deeds.push(`called a vote on "${vote.question}", and ${result}`)
  }
  return deeds
}

// The model's copy of a group's conversation, for the bot answering it.
// Group bots share one conversation, but a model takes every earlier
// assistant message as its own. So only this bot's answers stay its own, with
// their tool calls; another bot's answer reaches it quoted in brackets, as
// [Linus answered (#a1b2c3d4): "…"], on the user's side, with the
// reference it's flagged by. Each of the user's messages is
// headed with who it's for and what it replies to, as in [To Quill, replying
// to Linus: "…"]: the bot whose answer follows it, or this turn's bot for the
// newest. Side by side user messages are merged, as some providers want turns
// to alternate. A turn the chat runs on its own ends with a `cue`: why this
// bot is up. That also keeps the conversation from ending on this bot's own
// answer, as when its message was flagged: models won't carry on from one.
// `tools` convert this bot's own tool calls, so their toModelOutput applies.
export async function groupContext(
  history: UIMessage[],
  names: Map<string, string>,
  botId: string,
  tools: ToolSet,
  cue?: string
): Promise<ModelMessage[]> {
  const nameOf = (id: string | undefined) =>
    (id && names.get(id)) ?? "a bot that has left"

  const context: ModelMessage[] = []
  const addUser = (parts: UserContent) => {
    const previous = context.at(-1)
    if (previous?.role !== "user") {
      context.push({ role: "user", content: parts })
      return
    }
    const earlier: UserContent =
      typeof previous.content === "string"
        ? [{ type: "text", text: previous.content }]
        : previous.content
    context[context.length - 1] = {
      ...previous,
      content: [...earlier, ...(parts as Exclude<UserContent, string>)],
    }
  }
  const convert = (message: UIMessage) =>
    convertToModelMessages([message], {
      tools,
      ignoreIncompleteToolCalls: true,
    })

  for (const [index, message] of history.entries()) {
    if (message.role === "user") {
      const next = history[index + 1]
      const handedTo = next && handoffOf(next)
      let note = !next
        ? `To ${nameOf(botId)}`
        : next.role === "assistant"
          ? `To ${nameOf(metadataOf(next)?.botId)}${handedTo ? `, who handed it to ${handedTo.name}` : ""}`
          : "Unanswered"
      const replyTo = metadataOf(message)?.replyTo
      const original = replyTo
        ? history.find((earlier) => earlier.id === replyTo)
        : undefined
      if (original) {
        const author =
          original.role === "user"
            ? "the user's own message"
            : nameOf(metadataOf(original)?.botId)
        note += `, replying to ${author}: "${clipped(textOf(original), REPLY_SNIPPET)}"`
      }
      for (const converted of await convert(message)) {
        if (converted.role !== "user") continue
        addUser([
          { type: "text", text: `[${note}]` },
          ...(typeof converted.content === "string"
            ? [{ type: "text" as const, text: converted.content }]
            : converted.content),
        ])
      }
      continue
    }

    if (message.role !== "assistant") continue
    const author = metadataOf(message)?.botId
    // Answers from before bots were stamped count as this bot's.
    if (!author || author === botId) {
      context.push(...(await convert(message)))
      continue
    }
    const text = textOf(message)
    const said = [
      text && `"${clipped(text, ANSWER_QUOTE)}"`,
      ...deedsOf(message),
    ]
      .filter(Boolean)
      .join(", and ")
    addUser([
      {
        type: "text",
        text: `[${nameOf(author)} answered (#${messageRef(message.id)})${said ? `: ${said}` : " without a message"}]`,
      },
    ])
  }
  if (cue) addUser([{ type: "text", text: `[${cue}]` }])
  return prepareContext(context)
}

// The latest of a group's conversation as plain lines, for a quick read:
// the director picking who speaks next on autopilot, and bots casting their
// ballots. Each message is cut short, and only the text and what bots did
// beyond it show.
export function transcriptOf(
  history: UIMessage[],
  names: Map<string, string>,
  { messages = 30, perMessage = 700 } = {}
) {
  const nameOf = (id: string | undefined) =>
    (id && names.get(id)) ?? "A bot that has left"
  return history
    .slice(-messages)
    .map((message, index, recent) => {
      if (message.role === "user") {
        const next = recent[index + 1]
        const to =
          next?.role === "assistant"
            ? ` (to ${nameOf(metadataOf(next)?.botId)})`
            : ""
        return `User${to}: ${clipped(textOf(message), perMessage)}`
      }
      const said = [
        clipped(textOf(message), perMessage),
        ...deedsOf(message).map((deed) => `[It ${deed}]`),
      ]
        .filter(Boolean)
        .join(" ")
      return `${nameOf(metadataOf(message)?.botId)} (#${messageRef(message.id)}): ${said || "(no message)"}`
    })
    .join("\n\n")
}
