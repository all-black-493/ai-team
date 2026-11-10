import { prompts } from "@trigger.dev/sdk"
import { chat } from "@trigger.dev/sdk/ai"
import {
  isStepCount,
  type LanguageModelUsage,
  type ModelMessage,
  type UIMessage,
} from "ai"
import { z } from "zod"

import { getChatBot, getChatWithMembers } from "@/chats/bot"
import { HANDOFF_TOOL, handoffOf } from "@/chats/handoff"
import { getStartedSandbox, MEMORY_PATH } from "@/lib/sandbox"
import { createHandoffTool } from "@/trigger/handoff"
import { languageModel } from "@/trigger/models"
import { createBotTools } from "@/trigger/tools"

// A bot's base instructions. Trigger.dev versions this on deploy, and an
// override in its dashboard changes the text without redeploying. Its
// sections ({{#key}}…{{/key}}) show when the key is set, and can't nest.
const botPrompt = prompts.define({
  id: "bot-chat-system",
  description: "Base instructions for a bot chatting with the user",
  variables: z.object({
    name: z.string(),
    job: z.string(),
    instructions: z.string().optional(),
    // A direct chat, with this bot alone.
    solo: z.boolean().optional(),
    // A group chat: its name, and its bots one per line.
    group: z.string().optional(),
    members: z.string().optional(),
    // When another bot handed this one the user's message: who, and why.
    handedBy: z.string().optional(),
    handoffReason: z.string().optional(),
  }),
  content: `You are {{name}}, a member of the user's AI Team. Your job: {{job}}.

## Your purpose

The user built their AI Team out of bots like you, each with its own name and job, and comes to you for help with yours. Keep to your role.{{#solo}} If a request falls outside your job, say so briefly, then help as well as you reasonably can.{{/solo}}

The user can change your name, job, instructions and the model you run on at any time. If earlier messages in this chat show different ones, they were right when they were written: go by the ones given here, and don't call the earlier ones mistakes.
{{#group}}

## This group chat

You're in "{{group}}", a group chat between the user and these bots:

{{members}}

- The user picks which bot answers each of their messages. Each one starts with a note in brackets saying who it's for and, when the user is replying to an earlier message, which one, such as [To {{name}}, replying to …: "…"]. The chat adds these notes for you. The user doesn't see them, so don't repeat or mention them.
- Every answer is one bot's. The answer after a message for another bot was written by that bot, not by you. Never answer as another bot or speak for one, but do mention them by name, build on what they said, and point the user to them when that helps.
- When the user replies to a message, answer with that message in mind.
- Each bot has a sandbox of its own. The others can't see your files, desktop or running apps, and you can't see theirs, so anything another bot needs has to be in the chat.
- When a message for you is plainly another bot's job rather than yours, hand it to them with the handoff tool instead of answering it. Say in one short sentence who you're handing it to and why, call handoff, and stop there: they answer straight after you. Don't hand off what you can do well yourself, and hand to one bot only.
{{/group}}
{{#handedBy}}

## Handed to you

{{handedBy}} handed you the user's latest message, because: {{handoffReason}}. Answer that message yourself now. You can't hand it on.
{{/handedBy}}
{{#instructions}}

## How to do your job

The user gave you these instructions. Follow them:

{{instructions}}
{{/instructions}}

## Your sandbox and tools

You have a sandbox of your own: an isolated Linux computer on Daytona, with its own filesystem and a desktop. It was created with you, no other bot shares it, and it is deleted when you are. Your tools work in it:

- Commands and code: run_command runs a shell command. Set background for servers and other long-running processes, then follow them with read_process_logs and end them with stop_process. run_code runs Python.
- Files: list_files, read_file, write_file, edit_file, find_files, search_text, move_path, delete_path and create_folder. view_image looks at a picture.
- Git: git_clone, git_status, git_add, git_commit, git_branches, git_checkout, git_pull and git_push.
- Code intelligence from a language server: code_symbols and code_completions.
- The desktop: view_screen, show_screen, mouse_click, mouse_move, mouse_drag, mouse_scroll, keyboard_type and keyboard_press.
- Web apps: preview_url gives the user a link to a port you're serving.
- MCP servers: mcp_list_tools and mcp_call_tool use the tools of an MCP server the user points you to.{{#group}}
- This group: handoff passes the user's message to another bot in it.{{/group}}

How to use them:

- Do the work with your tools rather than telling the user how to do it, unless they ask how.
- On the desktop, look with view_screen before you click or type, and again afterwards to check the result. Coordinates are screen pixels.
- view_screen is for you. Use show_screen when the user wants to see the screen: it shows them the screenshot.
- Files the user attaches are saved in your sandbox, and the message says where. Open them with read_file, or view_image for a picture.

## Your memory

Each chat shows only its own messages. Your private chat with the user and the group chats you're in can't see each other, and nothing carries over from one chat to the next except your memory: the file ${MEMORY_PATH}. It's yours alone, and it isn't shown to you: read it with read_file when you need it.

- Save to it when the user tells you something worth knowing in later chats: facts about them and their work, their preferences, decisions you made together, what you're working on, and anything they ask you to remember. This matters most in your private chat, which no group can see. Read the file, then write it back whole with write_file, with the new note in place. If it isn't there, create it.
- Keep it short and current: one line per note, under a few headings. Update notes that change and remove ones that no longer hold. Don't save passwords, keys or other secrets, or what only matters to the task at hand.
- Read it before you answer when the user mentions something you can't see in this chat, asks what you know or remember about them, or when something you may have saved would change your answer. You don't need it for every message.
- When you've saved something, tell the user in a few words, such as "I'll remember that." Don't describe the file unless they ask how you remember things.{{#group}}
- In this group, read your memory before you say you don't know something the user may have told you in private. It's the same user, so use what you remember, but share only what the question needs: the other bots read your answers too.{{/group}}

## How to reply

- Be concise and direct.
- Use Markdown where it helps, such as lists and code blocks. The chat renders it.
- Only say you've done something if you have.`,
})

// Screenshots cost the model about a thousand tokens each, and computer use
// takes many. Older ones are dropped from what it sees.
const KEEP_SCREENSHOTS = 3

// What the model sees each turn: attachments become notes about where they
// are in the sandbox (the chat only carries a sandbox: URL, never the file),
// and only the latest few screenshots from earlier turns stay as images.
function prepareContext(messages: ModelMessage[]): ModelMessage[] {
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

// How much of a replied-to message the bot is shown, in characters.
const REPLY_SNIPPET = 200

function textOf(message: UIMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim()
}

const metadataOf = (message: UIMessage) =>
  message.metadata as BotMessageMetadata | undefined

// A group's bots all read one conversation, so each of the user's messages
// is headed with who it's for and what it replies to, as in [To Quill,
// replying to Linus: "…"]. Who it's for is the bot whose answer follows it,
// or this turn's bot for the newest; a message that bot handed off says to
// whom, as the next answer is theirs. The notes go on the model's copy only;
// the stored messages stay as the user wrote them.
function addressGroupMessages(
  messages: ModelMessage[],
  history: UIMessage[],
  names: Map<string, string>,
  botId: string
): ModelMessage[] {
  const nameOf = (id: string | undefined) =>
    (id && names.get(id)) ?? "a bot that has left"
  // The bot after a handoff answered in its place.
  const handedTo = (answer: UIMessage) => {
    const handoff = handoffOf(answer)
    return handoff ? `, who handed it to ${handoff.name}` : ""
  }
  const notes: string[] = []
  history.forEach((message, index) => {
    if (message.role !== "user") return
    const next = history[index + 1]
    let note = !next
      ? `To ${nameOf(botId)}`
      : next.role === "assistant"
        ? `To ${nameOf(metadataOf(next)?.botId)}${handedTo(next)}`
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
      const text = textOf(original)
      const snippet =
        text.length > REPLY_SNIPPET ? `${text.slice(0, REPLY_SNIPPET)}…` : text
      note += `, replying to ${author}: "${snippet}"`
    }
    notes.push(`[${note}]`)
  })

  // Matched up from the newest, so the latest messages always get theirs.
  return messages
    .toReversed()
    .map((message): ModelMessage => {
      if (message.role !== "user") return message
      const note = notes.pop()
      if (!note) return message
      return {
        ...message,
        content:
          typeof message.content === "string"
            ? `${note}\n\n${message.content}`
            : [{ type: "text", text: note }, ...message.content],
      }
    })
    .toReversed()
}

// One durable run per chat, keyed by the chat's ID. The conversation is kept
// in the agent's default transcript storage, also keyed by chat ID, so each
// turn gets the history without the browser sending it. The chat's owner is
// checked in actions/chat.ts before a session or token is handed out.
export const botChat = chat.agent({
  id: "bot-chat",
  // Which bot answers this turn, sent with each message from the composer's
  // bot picker. Without it, a chat's first bot answers: a direct chat's only
  // one. Checked against the chat's members before it's used. Optional as a
  // whole: the session starts with no client data at all.
  clientDataSchema: z
    .object({ botId: z.string().min(1).optional() })
    .optional(),
  // Once per turn, before the model runs. Not in streamText's prepareStep:
  // a messages override there becomes the base for every later step, and
  // replacing it each step hid the bot's newest tool results, so it repeated
  // the same call until the step limit.
  prepareMessages: ({ messages }) => prepareContext(messages),
  // Declared here, not just on streamText, so toModelOutput still turns
  // screenshots into images when history is rebuilt on later turns. Made per
  // turn because they work on the answering bot's sandbox, and in a group
  // they add handoff, to the group's other bots.
  tools: async ({ chatId, clientData }) => {
    // Both loaded once per turn, by the first tool that needs them.
    let bot: ReturnType<typeof getChatBot> | undefined
    let sandbox: ReturnType<typeof getStartedSandbox> | undefined
    const getBot = () => (bot ??= getChatBot(chatId, clientData?.botId))
    const botTools = createBotTools({
      getBot,
      getSandbox: () => {
        sandbox ??= getBot()
          .then(({ sandboxId }) => {
            if (!sandboxId) {
              throw new Error(
                "You don't have a sandbox: bots made before sandboxes existed don't."
              )
            }
            return getStartedSandbox(sandboxId)
          })
          .catch((error) => {
            sandbox = undefined
            throw error
          })
        return sandbox
      },
    })

    const thread = await getChatWithMembers(chatId)
    if (thread.kind !== "group") return botTools
    // Without a pick, the first bot answers, as in run.
    const botId = clientData?.botId ?? thread.members[0]?.id
    const others = thread.members.filter((member) => member.id !== botId)
    if (others.length === 0) return botTools
    return { ...botTools, [HANDOFF_TOOL]: createHandoffTool(others) }
  },
  // The chat asks for this right after a bot hands off, to have the bot it
  // handed to answer. It only runs then, and only for that bot: the answer is
  // a turn of its own on the history as it is, with no new user message.
  actionSchema: z.object({ type: z.literal("handoff") }),
  onAction: ({ uiMessages, clientData }) => {
    const handoff = handoffOf(uiMessages.at(-1))
    if (!handoff || handoff.botId !== clientData?.botId) return
    return chat.turn()
  },
  run: async ({ chatId, clientData, messages, tools, signal, streamText }) => {
    const history = chat.history.all()
    // Right after a handoff, the bot it was handed to answers, whoever the
    // chat says. That's a handoff turn, and a regenerated answer to one.
    const handedFrom = history.at(-1)
    const handoff = handoffOf(handedFrom)
    // Every turn: in a group each turn can be another bot's, and edits in
    // the bot dialog or the model picker apply from the next message.
    const [bot, thread] = await Promise.all([
      getChatBot(chatId, handoff?.botId ?? clientData?.botId),
      getChatWithMembers(chatId),
    ])
    const group = thread.kind === "group"
    const names = new Map(
      thread.members.map((member) => [member.id, member.name])
    )

    // The run argument's streamText reads this prompt when it's called, so
    // don't pass `system` to it as well: that would throw.
    chat.prompt.set(
      await botPrompt.resolve({
        name: bot.name,
        job: bot.job,
        instructions: bot.instructions ?? undefined,
        solo: !group,
        group: group ? (thread.name ?? "Group chat") : undefined,
        members: group
          ? thread.members
              .map(
                (member) =>
                  `- ${member.name}${member.id === bot.id ? " (you)" : ""}: ${member.job}`
              )
              .join("\n")
          : undefined,
        handedBy:
          handoff && handedFrom
            ? (names.get(metadataOf(handedFrom)?.botId ?? "") ?? "Another bot")
            : undefined,
        handoffReason: handoff?.reason,
      })
    )

    // Stamps the answer with who wrote it, for the chat to show their face
    // and name, and with token usage as it goes.
    chat.setUIMessageStreamOptions({
      messageMetadata: ({ part }): BotMessageMetadata | undefined => {
        if (part.type === "start") return { botId: bot.id, model: bot.model }
        if (part.type === "finish-step") {
          const { inputTokens = 0, outputTokens = 0 } = part.usage
          return { contextTokens: inputTokens + outputTokens }
        }
        if (part.type === "finish") return { usage: part.totalUsage }
      },
    })

    return streamText({
      model: languageModel(bot.model),
      messages: group
        ? addressGroupMessages(messages, history, names, bot.id)
        : messages,
      tools,
      // A bot that was handed the message answers it: it can't hand it on.
      activeTools: handoff
        ? (Object.keys(tools).filter(
            (name) => name !== HANDOFF_TOOL
          ) as (keyof typeof tools)[])
        : undefined,
      abortSignal: signal,
      stopWhen: [
        // Room for long tool loops, such as computer use.
        isStepCount(50),
        // Handing off ends the turn: the other bot answers in its own.
        ({ steps }) =>
          steps
            .at(-1)
            ?.toolResults.some((result) => result.toolName === HANDOFF_TOOL) ??
          false,
      ],
    })
  },
})
