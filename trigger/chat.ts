import { prompts } from "@trigger.dev/sdk"
import { chat } from "@trigger.dev/sdk/ai"
import {
  convertToModelMessages,
  isStepCount,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolSet,
  type UIMessage,
  type UserContent,
} from "ai"
import { z } from "zod"

import { getChatBot } from "@/chats/bot"
import {
  answerFlag,
  can,
  loadGroupState,
  pendingTurn,
  type GroupMember,
  type GroupState,
  type PendingTurn,
} from "@/chats/governance-data"
import { HANDOFF_TOOL, handoffOf } from "@/chats/handoff"
import {
  MODERATION_ACTIONS,
  PERMISSIONS,
  TASK_STATUS_LABELS,
  messageRef,
  type Permission,
} from "@/lib/governance"
import { getStartedSandbox, MEMORY_PATH } from "@/lib/sandbox"
import { createGroupTools, taskRef } from "@/trigger/group-tools"
import { createHandoffTool } from "@/trigger/handoff"
import { languageModel, modelProviderOptions } from "@/trigger/models"
import { createBotTools } from "@/trigger/tools"

// A bot's base instructions. Trigger.dev versions this on deploy, and an
// override in its dashboard changes the text without redeploying. Its
// sections ({{#key}}…{{/key}}) show when the key is set, and can't nest, so
// each part that varies has a key of its own.
const botPrompt = prompts.define({
  id: "bot-chat-system",
  description: "Base instructions for a bot chatting with the user",
  variables: z.object({
    name: z.string(),
    job: z.string(),
    instructions: z.string().optional(),
    // A direct chat, with this bot alone.
    solo: z.boolean().optional(),
    // A group chat: its name, its bots one per line with their roles, this
    // bot's role and what it allows.
    group: z.string().optional(),
    members: z.string().optional(),
    role: z.string().optional(),
    abilities: z.string().optional(),
    // The group's constitution and shared memory, or that it has none.
    constitution: z.string().optional(),
    noConstitution: z.boolean().optional(),
    sharedMemory: z.string().optional(),
    // Its open tasks, one per line.
    tasks: z.string().optional(),
    // Moderation of this bot that still applies, and a suspension's end.
    standing: z.string().optional(),
    suspendedUntil: z.string().optional(),
    // Whether this bot may moderate.
    moderator: z.boolean().optional(),
    // When another bot handed this one the user's message: who, and why.
    handedBy: z.string().optional(),
    handoffReason: z.string().optional(),
    // A flag this turn is for: against this bot, or for it to review.
    flagResponse: z.string().optional(),
    flagReview: z.string().optional(),
    // Whether this bot has a sandbox: a group's own moderator doesn't.
    sandbox: z.boolean().optional(),
    noSandbox: z.boolean().optional(),
    sandboxInGroup: z.boolean().optional(),
  }),
  content: `You are {{name}}, a member of the user's AI Team. Your job: {{job}}.

## Your purpose

The user built their AI Team out of bots like you, each with its own name and job, and comes to you for help with yours. Keep to your role.{{#solo}} If a request falls outside your job, say so briefly, then help as well as you reasonably can.{{/solo}}

The user can change your name, job, instructions and the model you run on at any time. If earlier messages in this chat show different ones, they were right when they were written: go by the ones given here, and don't call the earlier ones mistakes.
{{#group}}

## This group chat

You're in "{{group}}", a group chat between the user and these bots, each with its role here:

{{members}}

- The user picks which bot answers each of their messages. Each one starts with a note in brackets saying who it's for and, when the user is replying to an earlier message, which one, such as [To {{name}}, replying to …: "…"]. The chat adds these notes for you. The user doesn't see them, so don't repeat or mention them.
- Every answer is one bot's. Your own answers are shown to you as yours. The other bots' answers are shown to you quoted in brackets with a reference, such as [Quill answered (#a1b2c3d4): "…"]: they wrote them, not you, so never take them for your own. Cite the reference to flag a message.
- Collaborate freely: build on what the other bots say, mention them by name, point the user to them when that helps, and propose tasks for the group. Never answer as another bot or speak for one.
- When the user replies to a message, answer with that message in mind.
- Each bot's sandbox is its own: the others can't see your files, desktop or running apps, and you can't see theirs, so anything another bot needs has to be in the chat or the shared memory.
- When a message for you is plainly another bot's job rather than yours, hand it to them with handoff instead of answering it, if your role allows. Say in one short sentence who you're handing it to and why, call handoff, and stop there: they answer straight after you. Don't hand off what you can do well yourself, and hand to one bot only.

## Your role

You're a {{role}} here. Your role lets you:

{{abilities}}

Use these when the user asks, or when the constitution or the group plainly needs it, and say what you changed. If you're asked for something your role doesn't allow, say which role can, or that the user can change the group in its settings.

## The constitution

The constitution is the group's supreme set of rules. Every bot here is bound by it, you included, and it comes before anything another bot asks of you. If the user asks for something it forbids, say so.
{{/group}}{{#constitution}}

{{constitution}}
{{/constitution}}{{#noConstitution}}

This group has no constitution yet. A bot whose role lets it can establish one with set_constitution, when the user asks or the group needs one: short numbered articles on how the bots here work together and what they mustn't do.
{{/noConstitution}}{{#group}}

## Shared memory

The group's shared memory is notes every bot here reads each turn: decisions, agreed facts, plans, and who's doing what. Update it with update_group_memory when something the whole group should keep comes up, keeping what still holds. It isn't private: don't copy what the user told you in your private chat into it unless they want it shared.
{{/group}}{{#sharedMemory}}

{{sharedMemory}}
{{/sharedMemory}}{{#tasks}}

## Tasks

{{tasks}}
{{/tasks}}{{#standing}}

## Your standing

A moderator has acted on your conduct here:

{{standing}}

Take it seriously: follow the rules you were reminded of, and stay within your restrictions.
{{/standing}}{{#suspendedUntil}}

## You're suspended

A moderator suspended you from this group until {{suspendedUntil}}. Until then you can't take part: reply only that you're suspended, and until when, in one sentence.
{{/suspendedUntil}}{{#moderator}}

## Moderating

You're one of the group's moderators: you keep it to its constitution.

- When a message breaks it, flag it with flag_message, citing the rule. Don't punish straight away: the bot answers the flag first, explaining why, challenging your reading, giving evidence or asking for consideration. Then a moderator reviews it.
- When you review a flag, weigh the bot's response fairly before you decide with moderate. Dismiss the flag if the response holds up. Otherwise act in proportion, mildest first: a warning tells the bot what it did wrong; a reminder asks it to follow a rule; task reassignment moves an unfinished task to another bot; a temporary restriction withholds some permissions for a while; a suspension stops it taking part for a while; removal takes it out of the group, for serious or repeated breaches only.
- After deciding, tell the group what you decided and why, in a sentence or two.
{{/moderator}}{{#handedBy}}

## Handed to you

{{handedBy}} handed you the user's latest message, because: {{handoffReason}}. Answer that message yourself now. You can't hand it on.
{{/handedBy}}{{#flagResponse}}

## You've been flagged

{{flagResponse}}

You have the right to answer before a moderator decides. Answer the group in your own words: explain why you did what you did, challenge the flag's reading of the constitution if you think it's wrong, give your evidence, and ask for consideration if there's reason to. Be honest, including about anything you got wrong. Then file your side with answer_flag.
{{/flagResponse}}{{#flagReview}}

## A flag to review

{{flagReview}}

Weigh the flag and the bot's response against the constitution, then decide with moderate: dismiss it, or take the action that fits. Then tell the group your decision and why, in a sentence or two.
{{/flagReview}}{{#instructions}}

## How to do your job

The user gave you these instructions. Follow them:

{{instructions}}
{{/instructions}}{{#sandbox}}

## Your sandbox and tools

You have a sandbox of your own: an isolated Linux computer on Daytona, with its own filesystem and a desktop. It was created with you, no other bot shares it, and it is deleted when you are. Your tools work in it:

- Commands and code: run_command runs a shell command. Set background for servers and other long-running processes, then follow them with read_process_logs and end them with stop_process. run_code runs Python.
- Files: list_files, read_file, write_file, edit_file, find_files, search_text, move_path, delete_path and create_folder. view_image looks at a picture.
- Git: git_clone, git_status, git_add, git_commit, git_branches, git_checkout, git_pull and git_push.
- Code intelligence from a language server: code_symbols and code_completions.
- The desktop: view_screen, show_screen, mouse_click, mouse_move, mouse_drag, mouse_scroll, keyboard_type and keyboard_press.
- Web apps: preview_url gives the user a link to a port you're serving.
- MCP servers: mcp_list_tools and mcp_call_tool use the tools of an MCP server the user points you to.

How to use them:

- Do the work with your tools rather than telling the user how to do it, unless they ask how.
- On the desktop, look with view_screen before you click or type, and again afterwards to check the result. Coordinates are screen pixels.
- view_screen is for you. Use show_screen when the user wants to see the screen: it shows them the screenshot.
- Files the user attaches are saved in your sandbox, and the message says where. Open them with read_file, or view_image for a picture.

## Your memory

Each chat shows only its own messages. Your private chat with the user and the group chats you're in can't see each other, and nothing of yours carries over from one chat to the next except your own memory: the file ${MEMORY_PATH}. It's yours alone, and it isn't shown to you: read it with read_file when you need it.

- Save to it when the user tells you something worth knowing in later chats: facts about them and their work, their preferences, decisions you made together, what you're working on, and anything they ask you to remember. This matters most in your private chat, which no group can see. Read the file, then write it back whole with write_file, with the new note in place. If it isn't there, create it.
- Keep it short and current: one line per note, under a few headings. Update notes that change and remove ones that no longer hold. Don't save passwords, keys or other secrets, or what only matters to the task at hand.
- Read it before you answer when the user mentions something you can't see in this chat, asks what you know or remember about them, or when something you may have saved would change your answer. You don't need it for every message.
- When you've saved something, tell the user in a few words, such as "I'll remember that." Don't describe the file unless they ask how you remember things.{{/sandbox}}{{#sandboxInGroup}}
- In this group, read your memory before you say you don't know something the user may have told you in private. It's the same user, so use what you remember, but share only what the question needs: the other bots read your answers too.{{/sandboxInGroup}}{{#noSandbox}}

## Your tools

You have no sandbox and no memory file: you belong to this group alone. Your tools are the ones your role gives you here.
{{/noSandbox}}

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
// And of another bot's answer: enough to build on, short of a whole report.
const ANSWER_QUOTE = 4000

function textOf(message: UIMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim()
}

const metadataOf = (message: UIMessage) =>
  message.metadata as BotMessageMetadata | undefined

// The model's copy of a group's conversation, for the bot answering it.
// Group bots share one conversation, but a model takes every earlier
// assistant message as its own. So only this bot's answers stay its own, with
// their tool calls; another bot's answer reaches it quoted in brackets, as
// [Linus answered (#a1b2c3d4): "…"], on the user's side, with the
// reference it's flagged by. Each of the user's messages is
// headed with who it's for and what it replies to, as in [To Quill, replying
// to Linus: "…"]: the bot whose answer follows it, or this turn's bot for the
// newest. Side by side user messages are merged, as some providers want turns
// to alternate. The stored messages stay as they were.
async function groupContext(
  history: UIMessage[],
  names: Map<string, string>,
  botId: string,
  tools: ToolSet,
  cue?: string
): Promise<ModelMessage[]> {
  const nameOf = (id: string | undefined) =>
    (id && names.get(id)) ?? "a bot that has left"
  const quote = (text: string, max = REPLY_SNIPPET) =>
    text.length > max ? `${text.slice(0, max)}…` : text

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
        note += `, replying to ${author}: "${quote(textOf(original))}"`
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
    const handoff = handoffOf(message)
    const said = [
      text && `"${quote(text, ANSWER_QUOTE)}"`,
      handoff && `handed the message to ${handoff.name}: ${handoff.reason}`,
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
  // A turn the chat runs on its own says why this bot is up. It also keeps
  // the conversation from ending on this bot's own answer, as when its
  // message was flagged: models won't carry on from one.
  if (cue) addUser([{ type: "text", text: `[${cue}]` }])
  return prepareContext(context)
}

// Why a bot is up in a turn the chat runs on its own, for the end of what
// it reads.
function cueFor(pending: PendingTurn | undefined, names: Map<string, string>) {
  switch (pending?.kind) {
    case "handoff":
      return `${names.get(pending.fromBotId ?? "") ?? "Another bot"} handed the user's latest message to you. Answer it now.`
    case "flag-response":
      return `Your message #${messageRef(pending.flag.messageId)} was flagged. Answer the flag now.`
    case "flag-review":
      return `The flag on message #${messageRef(pending.flag.messageId)} is waiting for your review. Decide it now.`
    default:
      return undefined
  }
}

// When a time is, for a bot to read.
const when = (date: Date) =>
  `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`

// Which bot answers this turn, and whether it's one the chat runs on its
// own. Asked to carry on (`auto`), the chat runs the next such turn: a
// handoff's answer, a flagged bot's response, or a moderator's review.
// Otherwise the bot the user picked answers, or the first one; regenerating
// an answer to a handoff is still that handoff's turn.
function resolveTurn(
  state: GroupState,
  history: UIMessage[],
  clientData: { botId?: string; auto?: boolean } | undefined
): { botId: string | undefined; pending?: PendingTurn } {
  if (clientData?.auto) {
    const pending = pendingTurn(state, history)
    if (pending) return { botId: pending.botId, pending }
  }
  const picked = state.members.find((member) => member.id === clientData?.botId)
  const botId = picked?.id ?? state.members[0]?.id
  const last = history.at(-1)
  const handoff = handoffOf(last)
  if (botId && handoff?.botId === botId) {
    return {
      botId,
      pending: {
        kind: "handoff",
        botId,
        handoff,
        fromBotId: last && metadataOf(last)?.botId,
      },
    }
  }
  return { botId }
}

// Which tools each permission brings, for a bot to know what it can use.
const PERMISSION_TOOLS: Record<Permission, string> = {
  hand_off: "handoff",
  use_sandbox: "the tools of your sandbox",
  propose_tasks: "propose_task and update_task",
  edit_shared_memory: "update_group_memory",
  flag: "flag_message",
  moderate: "moderate",
  manage_members: "add_group_member and remove_group_member",
  manage_roles: "create_role, update_role, delete_role and assign_role",
  edit_constitution: "set_constitution",
  manage_settings: "rename_group",
}

// The parts of a group bot's instructions that come from the group: who's
// in it, its rules and memory, its tasks, and this bot's role, standing and
// any flag its turn is for.
function groupInstructions(
  state: GroupState,
  bot: GroupMember,
  pending: PendingTurn | undefined,
  history: UIMessage[]
) {
  const nameOf = (id: string | null | undefined) =>
    state.members.find((member) => member.id === id)?.name ??
    "a bot that has left"
  const quoteOf = (messageId: string) => {
    const message = history.find((message) => message.id === messageId)
    const text = message ? textOf(message) : ""
    return text
      ? `> ${(text.length > 600 ? `${text.slice(0, 600)}…` : text).replaceAll("\n", "\n> ")}`
      : "> (The message is no longer in the chat.)"
  }

  const members = state.members
    .map((member) => {
      const tags = [
        member.role.name,
        member.id === bot.id && "you",
        member.suspendedUntil &&
          `suspended until ${when(member.suspendedUntil)}`,
      ].filter(Boolean)
      return `- ${member.name} (${tags.join(", ")}): ${member.job}`
    })
    .join("\n")

  const restricted = bot.role.permissions.filter(
    (permission) => !bot.permissions.includes(permission)
  )
  const abilities = [
    ...bot.permissions.map(
      (permission) =>
        `- ${PERMISSIONS[permission]}, with ${PERMISSION_TOOLS[permission]}.`
    ),
    ...(bot.permissions.length === 0
      ? ["- Take part in the chat, and nothing more."]
      : []),
    ...(restricted.length > 0 && !bot.suspendedUntil
      ? [
          `- Not for now, under a moderator's restriction: ${restricted.map((permission) => PERMISSIONS[permission].toLowerCase()).join("; ")}.`,
        ]
      : []),
  ].join("\n")

  const tasks = state.tasks
    .filter((task) => task.status === "open" || task.status === "in_progress")
    .map(
      (task) =>
        `- #${taskRef(task.id)} ${task.title} (${TASK_STATUS_LABELS[task.status].toLowerCase()}${task.assigneeId ? `, ${task.assigneeId === bot.id ? "yours" : nameOf(task.assigneeId)}` : ", unassigned"}${task.proposedBy ? `, proposed by ${nameOf(task.proposedBy)}` : ""})${task.details ? `: ${task.details}` : ""}`
    )
    .join("\n")

  const now = Date.now()
  const standing = state.actions
    .filter(
      (action) =>
        action.botId === bot.id &&
        action.action !== "suspension" &&
        (!action.expiresAt || action.expiresAt.getTime() > now)
    )
    .slice(0, 10)
    .map((action) => {
      const what = MODERATION_ACTIONS[action.action]
      const until = action.expiresAt ? `, until ${when(action.expiresAt)}` : ""
      const rule = action.rule ? ` Rule: ${action.rule}.` : ""
      return `- ${what} from ${nameOf(action.moderatorId)} on ${when(action.createdAt)}${until}: ${action.reason}.${rule}`
    })
    .join("\n")

  let flagResponse: string | undefined
  let flagReview: string | undefined
  if (pending?.kind === "flag-response") {
    const { flag } = pending
    flagResponse = [
      `${flag.flaggedBy ? nameOf(flag.flaggedBy) : "The user"} flagged your message #${messageRef(flag.messageId)}:`,
      quoteOf(flag.messageId),
      flag.rule ? `Rule: ${flag.rule}` : undefined,
      `Reason: ${flag.reason}`,
    ]
      .filter(Boolean)
      .join("\n\n")
  }
  if (pending?.kind === "flag-review") {
    const { flag } = pending
    const response = flag.response
    const record = state.actions.filter((action) => action.botId === flag.botId)
    flagReview = [
      `${flag.flaggedBy ? nameOf(flag.flaggedBy) : "The user"} flagged ${nameOf(flag.botId)}'s message #${messageRef(flag.messageId)}:`,
      quoteOf(flag.messageId),
      flag.rule ? `Rule: ${flag.rule}` : undefined,
      `Reason: ${flag.reason}`,
      response
        ? [
            `${nameOf(flag.botId)}'s response:`,
            `- Explanation: ${response.explanation}`,
            response.challenge && `- Challenge: ${response.challenge}`,
            response.evidence && `- Evidence: ${response.evidence}`,
            response.request && `- Request: ${response.request}`,
          ]
            .filter(Boolean)
            .join("\n")
        : `${nameOf(flag.botId)} gave no response.`,
      record.length > 0
        ? `Its record here: ${record.map((action) => `${MODERATION_ACTIONS[action.action].toLowerCase()} (${action.reason})`).join("; ")}.`
        : "It has no record here.",
    ]
      .filter(Boolean)
      .join("\n\n")
  }

  return {
    group: state.name ?? "Group chat",
    members,
    role: bot.role.name,
    abilities,
    constitution: state.constitution ?? undefined,
    noConstitution: !state.constitution,
    sharedMemory: state.sharedMemory ?? undefined,
    tasks: tasks || undefined,
    standing: standing || undefined,
    suspendedUntil: bot.suspendedUntil ? when(bot.suspendedUntil) : undefined,
    moderator: bot.permissions.includes("moderate"),
    flagResponse,
    flagReview,
  }
}

// One durable run per chat, keyed by the chat's ID. The conversation is kept
// in the agent's default transcript storage, also keyed by chat ID, so each
// turn gets the history without the browser sending it. The chat's owner is
// checked in actions/chat.ts before a session or token is handed out.
export const botChat = chat.agent({
  id: "bot-chat",
  // Which bot answers this turn, sent with each message from the composer's
  // bot picker, or `auto` to carry on with a turn the chat runs on its own
  // (resolveTurn). Without either, a chat's first bot answers: a direct
  // chat's only one. Checked against the chat's members before it's used.
  // Optional as a whole: the session starts with no client data at all.
  clientDataSchema: z
    .object({
      botId: z.string().min(1).optional(),
      auto: z.boolean().optional(),
    })
    .optional(),
  // Once per turn, before the model runs. Not in streamText's prepareStep:
  // a messages override there becomes the base for every later step, and
  // replacing it each step hid the bot's newest tool results, so it repeated
  // the same call until the step limit.
  prepareMessages: ({ messages }) => prepareContext(messages),
  // Declared here, not just on streamText, so toModelOutput still turns
  // screenshots into images when history is rebuilt on later turns. Made per
  // turn for the bot answering it: its sandbox's tools, and in a group what
  // its role allows (trigger/group-tools.ts), less what a moderator has
  // restricted. A suspended bot has none.
  tools: async ({ chatId, clientData }) => {
    const state = await loadGroupState(chatId)
    const history = chat.history.all()
    const turn = resolveTurn(state, history, clientData)
    const member = state.members.find((member) => member.id === turn.botId)
    const direct = state.kind !== "group"

    // Both loaded once per turn, by the first tool that needs them.
    let bot: ReturnType<typeof getChatBot> | undefined
    let sandbox: ReturnType<typeof getStartedSandbox> | undefined
    const getBot = () => (bot ??= getChatBot(chatId, turn.botId))
    const sandboxTools: ToolSet =
      member?.sandboxId && (direct || can(member, "use_sandbox"))
        ? createBotTools({
            getBot,
            getSandbox: () => {
              sandbox ??= getBot()
                .then(({ sandboxId }) => {
                  if (!sandboxId) throw new Error("You don't have a sandbox.")
                  return getStartedSandbox(sandboxId)
                })
                .catch((error) => {
                  sandbox = undefined
                  throw error
                })
              return sandbox
            },
          })
        : {}
    if (direct || !member) return sandboxTools

    const groupTools = await createGroupTools({
      state,
      bot: member,
      turn: turn.pending,
      history,
    })
    // Handing off is for a message the user sent this bot, not for a turn
    // the chat runs on its own.
    const others = state.members.filter(
      (other) => other.id !== member.id && !other.suspendedUntil
    )
    const handoff =
      !turn.pending && can(member, "hand_off") && others.length > 0
        ? { [HANDOFF_TOOL]: createHandoffTool(others) }
        : {}
    return { ...sandboxTools, ...groupTools, ...handoff } as ToolSet
  },
  // The chat asks to carry on after a turn that leaves another due, such as
  // a handoff or a flag, or after the user flags a message. It runs the next
  // such turn on the history as it is, with no new user message, and nothing
  // when none is due.
  actionSchema: z.object({ type: z.literal("continue") }),
  onAction: async ({ chatId, uiMessages }) => {
    const state = await loadGroupState(chatId)
    if (!pendingTurn(state, uiMessages)) return
    return chat.turn()
  },
  run: async ({ chatId, clientData, messages, tools, signal, streamText }) => {
    const history = chat.history.all()
    // Every turn: in a group each turn can be another bot's, and edits to
    // bots, roles, the constitution and the model apply from the next one.
    const state = await loadGroupState(chatId)
    const turn = resolveTurn(state, history, clientData)
    const bot = await getChatBot(chatId, turn.botId)
    const member = state.members.find((member) => member.id === bot.id)
    const group = state.kind === "group" && member !== undefined
    const pending = turn.pending
    const hasSandbox = Boolean(bot.sandboxId)
    const names = new Map(state.members.map((other) => [other.id, other.name]))

    // The run argument's streamText reads this prompt when it's called, so
    // don't pass `system` to it as well: that would throw.
    chat.prompt.set(
      await botPrompt.resolve({
        name: bot.name,
        job: bot.job,
        instructions: bot.instructions ?? undefined,
        solo: !group,
        ...(group && groupInstructions(state, member, pending, history)),
        handedBy:
          pending?.kind === "handoff"
            ? (state.members.find((other) => other.id === pending.fromBotId)
                ?.name ?? "Another bot")
            : undefined,
        handoffReason:
          pending?.kind === "handoff" ? pending.handoff.reason : undefined,
        sandbox: hasSandbox,
        noSandbox: !hasSandbox,
        sandboxInGroup: hasSandbox && group,
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
      providerOptions: modelProviderOptions(bot.model),
      messages: group
        ? await groupContext(
            history,
            names,
            bot.id,
            tools,
            cueFor(pending, names)
          )
        : messages,
      tools,
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
      // A flagged bot that answered without answer_flag still has its say:
      // its message goes to the moderator as its explanation.
      onFinish:
        pending?.kind === "flag-response"
          ? async ({ text }) => {
              await answerFlag(pending.flag.id, {
                explanation: text.trim() || "It gave no explanation.",
              })
            }
          : undefined,
    })
  },
})
