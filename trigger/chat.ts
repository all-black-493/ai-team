import { chat } from "@trigger.dev/sdk/ai"
import {
  convertToModelMessages,
  isStepCount,
  type ToolSet,
  type UIMessage,
} from "ai"
import { eq } from "drizzle-orm"
import { z } from "zod"

import { answeredApprovals, awaitsApproval } from "@/chats/approvals"
import { getChatBot } from "@/chats/bot"
import {
  loadLimits,
  recordEvent,
  recordUsage,
  spendOf,
} from "@/chats/budget-data"
import {
  answerFlag,
  can,
  loadGroupState,
  pendingTurn,
  type GroupState,
  type PendingTurn,
} from "@/chats/governance-data"
import { HANDOFF_TOOL, handoffOf } from "@/chats/handoff"
import {
  accessibleCollections,
  describeIssues,
  describePassages,
  knowledgeData,
  scoreCitations,
  SourceRegistry,
} from "@/chats/knowledge-data"
import {
  judgeRetrievals,
  logRetrieval,
  profileNotes,
  questionsIn,
  searchMemories,
} from "@/chats/memory-data"
import {
  claimAutomaticTurn,
  findClaim,
  finishTurn,
  startTurn,
} from "@/chats/turns-data"
import { db } from "@/db"
import { chats, type AgentTurn } from "@/db/schema"
import { budgetOf, describeScope } from "@/lib/budget"
import { chooseSpeaker } from "@/trigger/autopilot"
import { collaborationOutputs } from "@/trigger/collaboration"
import { compactedHistory, withSummary } from "@/trigger/compaction"
import {
  groupContext,
  metadataOf,
  prepareContext,
  textOf,
  type BotMessageMetadata,
} from "@/trigger/context"
import {
  approvalPolicy,
  governTools,
  recordCrossings,
  startExecution,
  toolSummary,
} from "@/trigger/governor"
import { createGroupTools } from "@/trigger/group-tools"
import { createHandoffTool } from "@/trigger/handoff"
import {
  createKnowledgeTools,
  knowledgeFor,
  type Collections,
} from "@/trigger/knowledge-tools"
import { createMemoryTools, type TurnRef } from "@/trigger/memory-tools"
import { languageModel, modelProviderOptions } from "@/trigger/models"
import { botPrompt, cueFor, groupInstructions } from "@/trigger/prompt"
import { createChatBotTools } from "@/trigger/tools"

export type { BotMessageMetadata, BotUIMessage } from "@/trigger/context"

type ClientData = { botId?: string; auto?: boolean } | undefined

// The point in the conversation a turn follows.
const lastIdOf = (history: UIMessage[]) => history.at(-1)?.id ?? "start"

// Which bot answers this turn, and whether it's one the chat runs on its
// own. After the user answers a bot's approval requests, that bot carries
// on. Asked to carry on (`auto`), the chat runs the next turn that's due, or
// on autopilot, the bot the director picked and the turn ledger kept.
// Otherwise the bot the user picked answers, or the first one;
// regenerating an answer to a handoff is still that handoff's turn.
function resolveTurn(
  state: GroupState,
  history: UIMessage[],
  clientData: ClientData,
  claimed: AgentTurn | undefined
): { botId: string | undefined; pending?: PendingTurn } {
  const last = history.at(-1)
  const author = last && metadataOf(last)?.botId
  const isMember = (botId: string | null | undefined) =>
    Boolean(botId) && state.members.some((member) => member.id === botId)
  if (answeredApprovals(last) && author && isMember(author)) {
    return { botId: author, pending: { kind: "approval", botId: author } }
  }
  if (clientData?.auto) {
    const due = pendingTurn(state, history)
    if (due) return { botId: due.botId, pending: due }
    if (
      claimed?.kind === "autopilot" &&
      claimed.botId &&
      isMember(claimed.botId)
    ) {
      return {
        botId: claimed.botId,
        pending: {
          kind: "autopilot",
          botId: claimed.botId,
          reason: claimed.reason ?? "",
        },
      }
    }
  }
  const picked = state.members.find((member) => member.id === clientData?.botId)
  const botId = picked?.id ?? state.members[0]?.id
  const handoff = handoffOf(last)
  if (botId && handoff?.botId === botId) {
    return {
      botId,
      pending: { kind: "handoff", botId, handoff, fromBotId: author },
    }
  }
  return { botId }
}

const TURN_TITLES: Record<PendingTurn["kind"] | "message", string> = {
  message: "Answered",
  handoff: "Answered a handed-off message",
  "flag-response": "Answered a flag",
  "flag-review": "Reviewed a flag",
  autopilot: "Took a turn on autopilot",
  approval: "Carried on after your decision",
}

// The bot's notes for this turn: those matching the latest message, logged
// to score against its answer, and what it knows of the user. A failed
// lookup leaves them out rather than failing the turn.
async function notesFor({
  botId,
  chatId,
  turnId,
  query,
}: {
  botId: string
  chatId: string
  turnId: string
  query: string
}) {
  try {
    const [matches, profile] = await Promise.all([
      searchMemories(botId, query, { limit: 5 }),
      profileNotes(botId),
    ])
    if (matches.length > 0) {
      await logRetrieval({
        botId,
        chatId,
        turnId,
        source: "auto",
        query,
        memoryIds: matches.map((note) => note.id),
      })
    }
    return [
      ...new Map(
        [...matches, ...profile].map((note) => [note.id, note])
      ).values(),
    ]
  } catch (error) {
    console.error("Couldn't look up memories", error)
    return []
  }
}

const FIRST_OUTPUT = new Set([
  "text-delta",
  "reasoning-delta",
  "tool-call",
  "tool-input-start",
])

type Prepared = Awaited<ReturnType<typeof startExecution>> & {
  startedAt: number
  claimed?: AgentTurn
  turn: TurnRef
  kept: UIMessage[]
  summary?: string
  collections: Collections
  sources: SourceRegistry
}

// Each turn's setup, made by the tools hook (which runs first) and read by
// its run.
const prepared = new Map<string, Prepared>()

async function prepare(chatId: string, clientData: ClientData) {
  const startedAt = Date.now()
  const state = await loadGroupState(chatId)
  const history = chat.history.all()
  const claimed = clientData?.auto
    ? await findClaim(chatId, lastIdOf(history))
    : undefined
  const resolved = resolveTurn(state, history, clientData, claimed)
  const member = state.members.find((member) => member.id === resolved.botId)
  const governed = await startExecution({
    userId: state.userId,
    chatId,
    botId: member?.id ?? resolved.botId ?? "",
    sandboxId: member?.sandboxId,
  })
  const names = new Map(state.members.map((other) => [other.id, other.name]))
  const botId = member?.id ?? resolved.botId
  const collections = botId
    ? await accessibleCollections(botId, chatId).catch((error) => {
        console.error("Couldn't load knowledge collections", error)
        return []
      })
    : []
  const context = await compactedHistory({
    chatId,
    userId: state.userId,
    history,
    names,
    threshold: governed.execution.limits.compactAfterTokens,
  }).catch((error) => {
    console.error("Couldn't compact the conversation", error)
    return { kept: history, summary: undefined }
  })
  const entry: Prepared = {
    ...governed,
    ...context,
    startedAt,
    claimed,
    turn: {},
    collections,
    sources: new SourceRegistry(),
  }
  prepared.set(chatId, entry)
  return { state, history, resolved, member, entry }
}

// One durable run per chat, keyed by the chat's ID. The conversation is kept
// in the agent's default transcript storage, also keyed by chat ID, so each
// turn gets the history without the browser sending it. The chat's owner is
// checked in actions/chat.ts before a session or token is handed out.
export const botChat = chat.agent({
  id: "bot-chat",
  // Which bot answers this turn, sent with each message from the composer's
  // bot picker, or `auto` to carry on with a turn the chat runs on its own
  // (resolveTurn). Optional as a whole: the session starts with no client
  // data at all.
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
  // Declared here, not just on streamText, so toModelOutput still applies
  // when history is rebuilt on later turns. Made per turn for the bot
  // answering it, and counted against the user's limits.
  tools: async ({ chatId, clientData }) => {
    const { state, history, resolved, member, entry } = await prepare(
      chatId,
      clientData
    )
    const { execution } = entry
    const direct = state.kind !== "group"
    const botId = member?.id ?? resolved.botId
    const memoryTools: ToolSet = botId
      ? {
          ...createMemoryTools({ botId, chatId, turn: entry.turn }),
          ...createKnowledgeTools({
            userId: state.userId,
            botId,
            chatId,
            collections: entry.collections,
            sources: entry.sources,
            turn: entry.turn,
          }),
        }
      : {}
    const sandboxTools: ToolSet =
      member?.sandboxId && (direct || can(member, "use_sandbox"))
        ? createChatBotTools(chatId, resolved.botId, {
            userId: state.userId,
            botId,
          })
        : {}
    if (direct || !member) {
      return governTools({ ...sandboxTools, ...memoryTools }, execution)
    }

    const groupTools = await createGroupTools({
      state,
      bot: member,
      turn: resolved.pending,
      history,
      kept: entry.kept,
      summary: entry.summary,
      turnRef: entry.turn,
      execution,
    })
    // Handing off is for a message the user sent this bot, not for a turn
    // the chat runs on its own.
    const others = state.members.filter(
      (other) => other.id !== member.id && !other.suspendedUntil
    )
    const handoff =
      (!resolved.pending || resolved.pending.kind === "approval") &&
      can(member, "hand_off") &&
      others.length > 0
        ? { [HANDOFF_TOOL]: createHandoffTool(others) }
        : {}
    return governTools(
      { ...sandboxTools, ...memoryTools, ...groupTools, ...handoff } as ToolSet,
      execution
    )
  },
  // The chat asks to carry on after a turn that leaves another due, such as
  // a handoff or a flag, after the user flags a message, and after every
  // answer on autopilot. Each such turn is claimed in the turn ledger once
  // per point in the conversation: one cut off is picked up again, one
  // underway or done isn't run twice. Nothing runs while an approval waits
  // on the user, once a spend limit is used up, or past autopilot's run.
  actionSchema: z.object({ type: z.literal("continue") }),
  onAction: async ({ chatId, uiMessages }) => {
    if (awaitsApproval(uiMessages.at(-1))) return
    const state = await loadGroupState(chatId)
    const limits = await loadLimits(state.userId)
    const budget = budgetOf(limits, await spendOf(state.userId, chatId))
    if (budget.exhausted) return

    const setTurns = (turns: number) =>
      db
        .update(chats)
        .set({ autopilotTurns: turns })
        .where(eq(chats.id, chatId))

    const claimed = await claimAutomaticTurn({
      chatId,
      userId: state.userId,
      afterMessageId: lastIdOf(uiMessages),
      maxTaskMinutes: limits.maxTaskMinutes,
      decide: async () => {
        const due = pendingTurn(state, uiMessages)
        if (due) return { kind: due.kind, botId: due.botId }
        if (state.kind !== "group" || !state.autopilot) return undefined
        if (state.autopilotTurns >= limits.maxAutopilotTurns) {
          // Recorded once: the count moves past the limit until it's reset.
          if (state.autopilotTurns === limits.maxAutopilotTurns) {
            await setTurns(state.autopilotTurns + 1)
            await recordEvent({
              chatId,
              category: "spent",
              title: `Autopilot paused after ${limits.maxAutopilotTurns} turns`,
            })
          }
          return undefined
        }
        const next = await chooseSpeaker(state, uiMessages, (model, usage) =>
          recordUsage({
            userId: state.userId,
            chatId,
            kind: "director",
            model,
            usage,
          })
        )
        if (!next) return undefined
        await setTurns(state.autopilotTurns + 1)
        return { kind: "autopilot", botId: next.botId, reason: next.reason }
      },
    })
    return claimed ? chat.turn() : undefined
  },
  run: async ({
    chatId,
    clientData,
    messages,
    tools,
    signal,
    streamText,
    trigger,
  }) => {
    const history = chat.history.all()
    // Every turn: in a group each turn can be another bot's, and edits to
    // bots, roles, the constitution and the model apply from the next one.
    const state = await loadGroupState(chatId)
    const entry =
      prepared.get(chatId) ?? (await prepare(chatId, clientData)).entry
    prepared.delete(chatId)
    const resolved = resolveTurn(state, history, clientData, entry.claimed)
    const bot = await getChatBot(chatId, resolved.botId)
    const member = state.members.find((member) => member.id === bot.id)
    const group = state.kind === "group" && member !== undefined
    const pending = resolved.pending
    const hasSandbox = Boolean(bot.sandboxId)
    const names = new Map(state.members.map((other) => [other.id, other.name]))
    const { execution, budget, summary } = entry
    // The tools hook can run before the newest messages reach the history,
    // as on a session's first turn, so what's kept is taken from the history
    // as it is now, from the first message the summary didn't cover.
    const firstKept = entry.kept[0]?.id
    const kept = history.slice(
      summary && firstKept
        ? Math.max(
            history.findIndex((message) => message.id === firstKept),
            0
          )
        : 0
    )

    if (budget.exhausted) {
      throw new Error(
        `Spend limit reached: ${describeScope(budget.scopes[0])}. Raise it to carry on.`
      )
    }
    if (group && !clientData?.auto && state.autopilotTurns > 0) {
      await db
        .update(chats)
        .set({ autopilotTurns: 0 })
        .where(eq(chats.id, chatId))
    }

    const turn = await startTurn({
      claimed: entry.claimed,
      chatId,
      userId: state.userId,
      botId: bot.id,
      kind:
        pending?.kind ??
        (trigger === "regenerate-message" ? "regenerate" : "message"),
      afterMessageId: lastIdOf(history),
    })
    entry.turn.id = turn.id
    try {
      const latest = history.findLast((message) => message.role === "user")
      const query = [
        latest && textOf(latest),
        pending?.kind === "autopilot" ? pending.reason : undefined,
      ]
        .filter(Boolean)
        .join("\n")
      const [notes, found] = await Promise.all([
        notesFor({ botId: bot.id, chatId, turnId: turn.id, query }),
        knowledgeFor(
          {
            userId: state.userId,
            botId: bot.id,
            chatId,
            collections: entry.collections,
            sources: entry.sources,
            turn: entry.turn,
          },
          query
        ),
      ])
      if (found.passages.length > 0) {
        chat.response.write({
          type: "data-knowledge",
          data: knowledgeData(
            entry.sources.add(found.passages),
            found.issues,
            entry.sources
          ),
        })
      }

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
          memories:
            notes
              .map(
                (note) =>
                  `- ${note.key} (${note.category}, v${note.version}): ${note.content}`
              )
              .join("\n") || undefined,
          sandbox: hasSandbox,
          noSandbox: !hasSandbox,
          knowledgeAccess:
            entry.collections
              .map((collection) => `"${collection.name}"`)
              .join(", ") || undefined,
          citeByNumber: entry.collections.length > 0,
          knowledge:
            describePassages(found.passages, entry.sources) || undefined,
          knowledgeIssues:
            describeIssues(found.issues, entry.sources) || undefined,
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

      let recorded = false
      const recordTurn = async (
        steps: { content: { type: string; toolName?: string }[] }[],
        stopped = false
      ) => {
        if (recorded) return
        recorded = true
        const parts = steps.flatMap((step) => step.content)
        const asked = parts.some(
          (part) => part.type === "tool-approval-request"
        )
        await recordEvent({
          chatId,
          botId: bot.id,
          category: "did",
          title: stopped
            ? "Stopped mid-answer"
            : asked
              ? "Asked for your approval"
              : TURN_TITLES[pending?.kind ?? "message"],
          detail: toolSummary(
            parts
              .filter(
                (part) =>
                  part.type === "tool-result" || part.type === "tool-error"
              )
              .map((part) => part.toolName ?? "")
          ),
          cost: execution.ownSpent,
        })
        const stop = execution.stopTitle()
        if (stop) {
          await recordEvent({
            chatId,
            botId: bot.id,
            category: "spent",
            title: stop,
            detail:
              execution.stopped === "spend"
                ? describeScope(budget.scopes[0])
                : execution.stopped === "time"
                  ? `${execution.limits.maxTaskMinutes} minutes a task`
                  : `${execution.limits.maxToolCalls} tool calls a turn`,
          })
        }
        await recordCrossings(execution, budget)
      }

      let firstOutputAt: number | undefined
      let inputTokens: number | undefined
      let outputTokens = 0
      let closed = false
      const closeTurn = async (
        status: "done" | "stopped" | "failed",
        text = ""
      ) => {
        if (closed) return
        closed = true
        const questions = text
          ? await questionsIn(bot.id, text)
          : { asked: false, repeated: false }
        if (text) {
          await judgeRetrievals(turn.id, text)
          await scoreCitations(turn.id, entry.sources.cited(text)).catch(
            (error) => console.error("Couldn't score citations", error)
          )
        }
        await finishTurn(turn.id, {
          status,
          inputTokens,
          outputTokens,
          firstTokenMs: firstOutputAt && firstOutputAt - entry.startedAt,
          durationMs: Date.now() - entry.startedAt,
          compacted: Boolean(summary),
          asked: questions.asked,
          repeatedQuestion: questions.repeated,
        })
      }

      const toolsForHistory = { ...collaborationOutputs, ...tools }
      const context = group
        ? await groupContext(
            kept,
            names,
            bot.id,
            // Reports and vote results stay short on later turns too.
            toolsForHistory,
            cueFor(pending, names),
            summary
          )
        : summary
          ? withSummary(
              prepareContext(
                await convertToModelMessages(kept, {
                  tools,
                  ignoreIncompleteToolCalls: true,
                })
              ),
              summary
            )
          : messages

      return streamText({
        model: languageModel(bot.model),
        providerOptions: modelProviderOptions(bot.model),
        messages: context,
        tools,
        abortSignal: execution.signal(signal),
        toolApproval: approvalPolicy(execution.limits, "ask"),
        stopWhen: [
          isStepCount(200),
          execution.stopWhen,
          // Handing off ends the turn: the other bot answers in its own.
          ({ steps }) =>
            steps
              .at(-1)
              ?.toolResults.some(
                (result) => result.toolName === HANDOFF_TOOL
              ) ?? false,
        ],
        onChunk: ({ chunk }) => {
          if (firstOutputAt === undefined && FIRST_OUTPUT.has(chunk.type)) {
            firstOutputAt = Date.now()
          }
        },
        onStepFinish: async ({ usage }) => {
          inputTokens ??= usage.inputTokens
          outputTokens += usage.outputTokens ?? 0
          await execution.record("turn", bot.model, usage)
        },
        onFinish: async ({ text, steps }) => {
          // A flagged bot that answered without answer_flag still has its
          // say: its message goes to the moderator as its explanation.
          if (pending?.kind === "flag-response") {
            await answerFlag(pending.flag.id, {
              explanation: text.trim() || "It gave no explanation.",
            })
          }
          await recordTurn(steps)
          await closeTurn(execution.stopped ? "stopped" : "done", text)
        },
        onAbort: async ({ steps }) => {
          await recordTurn(steps, true)
          await closeTurn("stopped")
        },
        onError: async ({ error }) => {
          await closeTurn("failed")
          await recordEvent({
            chatId,
            botId: bot.id,
            category: "did",
            title: "Couldn't answer",
            detail: error instanceof Error ? error.message : String(error),
          })
        },
      })
    } catch (error) {
      await finishTurn(turn.id, {
        status: "failed",
        durationMs: Date.now() - entry.startedAt,
      })
      await recordEvent({
        chatId,
        botId: bot.id,
        category: "did",
        title: "Couldn't answer",
        detail: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  },
})
