import { prompts } from "@trigger.dev/sdk"
import type { UIMessage } from "ai"
import { z } from "zod"

import type {
  GroupMember,
  GroupState,
  PendingTurn,
} from "@/chats/governance-data"
import {
  MODERATION_ACTIONS,
  PERMISSIONS,
  TASK_STATUS_LABELS,
  messageRef,
  type Permission,
} from "@/lib/governance"
import { MEMORY_PATH } from "@/lib/sandbox"
import { textOf } from "@/trigger/context"

// A task's reference, for bots to cite it by.
export const taskRef = (taskId: string) => taskId.slice(-6)

// A bot's base instructions. Trigger.dev versions this on deploy, and an
// override in its dashboard changes the text without redeploying. Its
// sections ({{#key}}…{{/key}}) show when the key is set, and can't nest, so
// each part that varies has a key of its own.
export const botPrompt = prompts.define({
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
    // Its open tasks, and what it decided by vote, one per line.
    tasks: z.string().optional(),
    decisions: z.string().optional(),
    // Whether the group is on autopilot.
    autopilot: z.boolean().optional(),
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
    // Work another bot set this one, alongside others at once, and whether
    // it's a delegated task to finish with finish_task.
    assignment: z.string().optional(),
    delegatedTask: z.boolean().optional(),
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

## Working together

- handoff passes the user's latest message to one other bot, who answers it straight after you. Use it when a message for you is plainly another bot's job: say in one short sentence who you're handing it to and why, call handoff, and stop there. Hand to one bot only, and don't hand off what you can do well yourself.
- consult sets one or more other bots to work at the same time, and brings their reports back to you before you reply: to split a job between them, gather their views, or have them check your work. Put everything you want done at once in one call, with a clear request for each bot. They work in parallel, each with its own tools, and can't see each other's work until they're done. Then build your answer on what they report.
- delegate gives other bots tasks of their own. They start on them at once, in parallel, and report back on each; the tasks are tracked for the whole group. It's how admins run the group's work.
- call_vote puts a question to the group when it has to decide something it disagrees on, or that binds every bot. Every bot that may vote casts its ballot at once, and the result is recorded as the group's decision. Don't call one for what one bot can settle, or for what the user has already decided.
- Your role says which of these you can use.

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
{{/tasks}}{{#decisions}}

## Decisions

The group voted on these. They bind every bot here, unless the constitution or the user says otherwise:

{{decisions}}
{{/decisions}}{{#autopilot}}

## Autopilot

The user has put this group on autopilot: its bots carry on together without waiting for them, and a director picks who speaks next. When it's your turn:

- Move the work on: take up your tasks, build on what the others did, answer what you were asked, consult or delegate where your role lets you, and call a vote when the group has to decide something.
- Talk to the other bots by name, as colleagues. The user reads along and can step in at any time.
- Don't wait for the user's go-ahead unless the constitution requires it, and don't ask them what you can settle among yourselves.
- Keep it short and don't repeat what's been said. When the work is done, or you're waiting on something only the user can give, say so plainly.
{{/autopilot}}{{#standing}}

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
{{/flagReview}}{{#assignment}}

## Your assignment

{{assignment}}

Do it now, on your own: you can't talk to the other bots until you're done, so make reasonable assumptions and say what they were. Your only tools here are your sandbox's; use them as the work needs. Then reply with a short report: what you did, what you found or made, and anything left open. Your report is all that goes back, so put everything that matters in it.
{{/assignment}}{{#delegatedTask}}
It's a task delegated to you: once you've worked on it, call finish_task to say whether it's done, then give your report.
{{/delegatedTask}}{{#instructions}}

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

// When a time is, for a bot to read.
export const when = (date: Date) =>
  `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`

// Which tools each permission brings, for a bot to know what it can use.
const PERMISSION_TOOLS: Record<Permission, string> = {
  hand_off: "handoff",
  consult: "consult",
  use_sandbox: "the tools of your sandbox",
  propose_tasks: "propose_task and update_task",
  delegate_tasks: "delegate",
  edit_shared_memory: "update_group_memory",
  call_votes: "call_vote",
  vote: "a ballot of your own whenever a vote is called",
  flag: "flag_message",
  moderate: "moderate",
  manage_members: "add_group_member and remove_group_member",
  manage_roles: "create_role, update_role, delete_role and assign_role",
  edit_constitution: "set_constitution",
  manage_settings: "rename_group",
}

// How many of the group's latest votes a bot is reminded of.
const DECISIONS_SHOWN = 10

// The parts of a group bot's instructions that come from the group: who's
// in it, its rules, memory and decisions, its tasks, whether it's on
// autopilot, and this bot's role, standing and any flag its turn is for.
export function groupInstructions(
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
        `- #${taskRef(task.id)} ${task.title} (${TASK_STATUS_LABELS[task.status].toLowerCase()}${task.assigneeId ? `, ${task.assigneeId === bot.id ? "yours" : nameOf(task.assigneeId)}` : ", unassigned"}${task.proposedBy ? `, proposed by ${nameOf(task.proposedBy)}` : ""})${task.details ? `: ${task.details}` : ""}${task.result ? ` Latest report: ${task.result}` : ""}`
    )
    .join("\n")

  const decisions = state.votes
    .slice(0, DECISIONS_SHOWN)
    .map((vote) => {
      const result = vote.outcome
        ? `decided "${vote.outcome}"`
        : "tied, so nothing was decided"
      const counts = vote.options
        .map(
          (option) =>
            `${option} ${vote.ballots.filter((ballot) => ballot.choice === option).length}`
        )
        .join(", ")
      return `- "${vote.question}", called by ${nameOf(vote.calledBy)} on ${when(vote.createdAt)}: ${result} (${counts}).`
    })
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
    decisions: decisions || undefined,
    autopilot: state.autopilot,
    standing: standing || undefined,
    suspendedUntil: bot.suspendedUntil ? when(bot.suspendedUntil) : undefined,
    moderator: bot.permissions.includes("moderate"),
    flagResponse,
    flagReview,
  }
}

// Why a bot is up in a turn the chat runs on its own, for the end of what
// it reads.
export function cueFor(
  pending: PendingTurn | undefined,
  names: Map<string, string>
) {
  switch (pending?.kind) {
    case "handoff":
      return `${names.get(pending.fromBotId ?? "") ?? "Another bot"} handed the user's latest message to you. Answer it now.`
    case "flag-response":
      return `Your message #${messageRef(pending.flag.messageId)} was flagged. Answer the flag now.`
    case "flag-review":
      return `The flag on message #${messageRef(pending.flag.messageId)} is waiting for your review. Decide it now.`
    case "autopilot":
      return `The group is on autopilot, and it's your turn: ${pending.reason}`
    default:
      return undefined
  }
}
