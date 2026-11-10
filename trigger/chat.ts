import { chat } from "@trigger.dev/sdk/ai"
import { isStepCount, type ToolSet, type UIMessage } from "ai"
import { z } from "zod"

import { getChatBot } from "@/chats/bot"
import {
  answerFlag,
  can,
  loadGroupState,
  pendingTurn,
  type GroupState,
  type PendingTurn,
} from "@/chats/governance-data"
import { HANDOFF_TOOL, handoffOf } from "@/chats/handoff"
import { autopilotTurns, chooseSpeaker } from "@/trigger/autopilot"
import { collaborationOutputs } from "@/trigger/collaboration"
import {
  groupContext,
  metadataOf,
  prepareContext,
  type BotMessageMetadata,
} from "@/trigger/context"
import { createGroupTools } from "@/trigger/group-tools"
import { createHandoffTool } from "@/trigger/handoff"
import { languageModel, modelProviderOptions } from "@/trigger/models"
import { botPrompt, cueFor, groupInstructions } from "@/trigger/prompt"
import { createChatBotTools } from "@/trigger/tools"

export type { BotMessageMetadata, BotUIMessage } from "@/trigger/context"

// Which bot answers this turn, and whether it's one the chat runs on its
// own. Asked to carry on (`auto`), the chat runs the next such turn: a
// handoff's answer, a flagged bot's response, a moderator's review, or on
// autopilot, the bot the director picked. Otherwise the bot the user picked
// answers, or the first one; regenerating an answer to a handoff is still
// that handoff's turn.
function resolveTurn(
  state: GroupState,
  history: UIMessage[],
  clientData: { botId?: string; auto?: boolean } | undefined
): { botId: string | undefined; pending?: PendingTurn } {
  if (clientData?.auto) {
    const picked = state.autopilot ? autopilotTurns.get(state.id) : undefined
    const pending =
      pendingTurn(state, history) ??
      (picked && state.members.some((member) => member.id === picked.botId)
        ? picked
        : undefined)
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
  // its role allows (trigger/group-tools.ts), working with other bots at
  // once among it (trigger/collaboration.ts), less what a moderator has
  // restricted. A suspended bot has none.
  tools: async ({ chatId, clientData }) => {
    const state = await loadGroupState(chatId)
    const history = chat.history.all()
    const turn = resolveTurn(state, history, clientData)
    const member = state.members.find((member) => member.id === turn.botId)
    const direct = state.kind !== "group"

    const sandboxTools: ToolSet =
      member?.sandboxId && (direct || can(member, "use_sandbox"))
        ? createChatBotTools(chatId, turn.botId)
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
  // a handoff or a flag, after the user flags a message, and after every
  // answer on autopilot. It runs the next such turn on the history as it is,
  // with no new user message: one that's due, or on autopilot, the bot the
  // director picks. Nothing when none is due and the director picks nobody.
  actionSchema: z.object({ type: z.literal("continue") }),
  onAction: async ({ chatId, uiMessages }) => {
    autopilotTurns.delete(chatId)
    const state = await loadGroupState(chatId)
    if (pendingTurn(state, uiMessages)) return chat.turn()
    if (state.kind !== "group" || !state.autopilot) return
    const next = await chooseSpeaker(state, uiMessages)
    if (!next) return
    autopilotTurns.set(chatId, next)
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
            // Reports and vote results stay short on later turns too.
            { ...collaborationOutputs, ...tools },
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
