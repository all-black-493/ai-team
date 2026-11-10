import { chat } from "@trigger.dev/sdk/ai"
import {
  generateText,
  isStepCount,
  isToolUIPart,
  Output,
  streamText,
  tool,
  type ToolSet,
  type UIMessage,
} from "ai"
import { eq } from "drizzle-orm"
import { z } from "zod"

import { getChatBot } from "@/chats/bot"
import {
  CONSULT_TOOL,
  DELEGATE_TOOL,
  FINISH_TASK_TOOL,
  outcomeOf,
  VOTE_TOOL,
  workKey,
  type ParallelOutput,
  type VoteBallot,
  type VoteOutput,
  type WorkResult,
} from "@/chats/collaboration"
import {
  can,
  loadGroupState,
  type GroupMember,
  type GroupState,
} from "@/chats/governance-data"
import { db } from "@/db"
import { groupTasks, groupVotes } from "@/db/schema"
import { ABSTAIN, MAX_PARALLEL_BOTS } from "@/lib/governance"
import {
  groupContext,
  textOf,
  transcriptOf,
  type BotMessageMetadata,
} from "@/trigger/context"
import { languageModel, modelProviderOptions } from "@/trigger/models"
import { botPrompt, groupInstructions, taskRef } from "@/trigger/prompt"
import { createChatBotTools } from "@/trigger/tools"

// How a group's bots work together at once: a bot sets others to work on
// something in parallel (consult), an admin gives them tasks (delegate), or
// a bot puts a question to the group's vote (call_vote). Each bot at work
// runs in this run, beside the others, on its own model and with its own
// sandbox, and streams its answer into the calling bot's message as it goes
// (chat.forwardSubAgent). LLM calls and sandbox commands mostly wait on the
// network, so running them side by side here costs no extra machine, and
// starts at once.

// How many steps a bot at work can take: room for real work in its sandbox.
const WORK_STEPS = 30
// A bot's report as the calling bot reads it, and as a task keeps it.
const REPORT_CHARS = 4000
const TASK_RESULT_CHARS = 2000
// What of a bot's work is kept with the calling bot's message: long text
// in tool calls is cut, and big outputs (screenshots, files) dropped. The
// chat stream takes about 1 MiB per record, and the work of six bots shares
// one.
const KEPT_TEXT = 2000
const KEPT_OUTPUT = 8000
const KEPT_ALL = 700_000

// Names match ignoring case and spaces.
const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text

const listOf = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`

// The bots a bot can set to work: the others, less any suspended.
const othersOf = (state: GroupState, bot: GroupMember) =>
  state.members.filter(
    (member) => member.id !== bot.id && !member.suspendedUntil
  )

// Work for one bot: what it was asked, the assignment it reads, and the
// delegated task it's for.
type Assignment = {
  bot: GroupMember
  request: string
  brief: string
  taskId?: string
}

// Strings over `max` characters in a tool call's input or output, cut.
function cutStrings(value: unknown, max: number): unknown {
  if (typeof value === "string") return clip(value, max)
  if (Array.isArray(value)) return value.map((item) => cutStrings(item, max))
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cutStrings(item, max)])
    )
  }
  return value
}

// A bot's work as kept with the calling bot's message: its text and what it
// did, with long inputs cut and big outputs dropped.
function keptWork(message: UIMessage): UIMessage {
  return {
    ...message,
    parts: message.parts.map((part) => {
      if (!isToolUIPart(part)) return part
      const input = cutStrings(part.input, KEPT_TEXT)
      if (part.state !== "output-available") return { ...part, input }
      const output =
        JSON.stringify(part.output ?? null).length > KEPT_OUTPUT
          ? undefined
          : part.output
      return { ...part, input, output }
    }) as UIMessage["parts"],
  }
}

// The last thing a bot said: its report.
function reportOf(message: UIMessage | undefined) {
  const last = message?.parts.findLast(
    (part) => part.type === "text" && part.text.trim()
  )
  return last?.type === "text" ? last.text.trim() : ""
}

// One bot doing its assignment: its own instructions and model, the group's
// conversation so far, its sandbox's tools, and finish_task for a delegated
// task. Its answer streams into the calling bot's message under `key`.
async function work({
  state,
  caller,
  history,
  assignment,
  key,
  abortSignal,
}: {
  state: GroupState
  caller: GroupMember
  history: UIMessage[]
  assignment: Assignment
  key: string
  abortSignal?: AbortSignal
}): Promise<WorkResult> {
  const { bot, request, taskId } = assignment
  const base = { botId: bot.id, bot: bot.name, request, taskId }
  let failure: unknown
  let finished: { done: boolean; summary: string } | undefined
  try {
    const record = await getChatBot(state.id, bot.id)
    const sandboxTools: ToolSet =
      record.sandboxId && can(bot, "use_sandbox")
        ? createChatBotTools(state.id, bot.id)
        : {}
    const tools: ToolSet = { ...sandboxTools }
    if (taskId) {
      tools[FINISH_TASK_TOOL] = tool({
        description:
          "Say whether your delegated task is done, once you've worked on it, with a one-line summary for the group's task list. Then give your report.",
        inputSchema: z.object({
          done: z.boolean().describe("Whether the task is finished"),
          summary: z.string().trim().min(1).max(500),
        }),
        execute: async (input) => {
          finished = input
          return { recorded: true }
        },
      })
    }
    const hasSandbox = Object.keys(sandboxTools).length > 0
    const names = new Map(state.members.map((other) => [other.id, other.name]))
    const prompt = await botPrompt.resolve({
      name: record.name,
      job: record.job,
      instructions: record.instructions ?? undefined,
      ...groupInstructions(state, bot, undefined, history),
      // At work, it has only its sandbox: no moderating, and no turns of
      // the chat's own.
      moderator: false,
      autopilot: false,
      assignment: assignment.brief,
      delegatedTask: Boolean(taskId),
      sandbox: hasSandbox,
      noSandbox: !record.sandboxId,
      sandboxInGroup: hasSandbox,
    })

    const result = streamText({
      model: languageModel(record.model),
      providerOptions: modelProviderOptions(record.model),
      system: prompt.text,
      messages: await groupContext(
        history,
        names,
        bot.id,
        tools,
        `${caller.name} set you to work on your assignment. Do it now.`
      ),
      tools,
      abortSignal,
      stopWhen: isStepCount(WORK_STEPS),
      onError: ({ error }) => {
        failure = error
      },
    })
    const message = await chat.forwardSubAgent<UIMessage>(
      result.toUIMessageStream({
        messageMetadata: ({ part }): BotMessageMetadata | undefined =>
          part.type === "start"
            ? { botId: bot.id, model: record.model }
            : undefined,
        onError: () => `${bot.name} ran into a problem.`,
      }),
      { toolCallId: key }
    )
    const report = reportOf(message) || (message ? textOf(message) : "")
    const status = abortSignal?.aborted
      ? "stopped"
      : failure !== undefined
        ? "failed"
        : "done"
    return {
      ...base,
      status,
      taskDone: taskId ? (finished?.done ?? false) : undefined,
      report: clip(
        finished && report
          ? `${finished.summary}\n\n${report}`
          : report || finished?.summary || "It gave no report.",
        REPORT_CHARS
      ),
      message: message && keptWork(message),
    }
  } catch (error) {
    return {
      ...base,
      status: abortSignal?.aborted ? "stopped" : "failed",
      taskDone: taskId ? false : undefined,
      report:
        error instanceof Error ? clip(error.message, 500) : "It broke off.",
    }
  }
}

// Every assignment at once. Each bot hears who else is working meanwhile.
// The work kept with the calling bot's message is dropped, reports apart,
// if it would be too big for one record.
async function workTogether({
  state,
  caller,
  history,
  assignments,
  toolCallId,
  abortSignal,
}: {
  state: GroupState
  caller: GroupMember
  history: UIMessage[]
  assignments: Assignment[]
  toolCallId: string
  abortSignal?: AbortSignal
}): Promise<ParallelOutput> {
  const results = await Promise.all(
    assignments.map((assignment, index) => {
      const others = assignments
        .filter((other) => other.bot.id !== assignment.bot.id)
        .map((other) => other.bot.name)
      const meanwhile =
        others.length > 0
          ? `\n\nMeanwhile ${listOf(others)} ${others.length === 1 ? "works" : "work"} on their own parts at the same time.`
          : ""
      return work({
        state,
        caller,
        history,
        assignment: { ...assignment, brief: assignment.brief + meanwhile },
        key: workKey(toolCallId, index),
        abortSignal,
      })
    })
  )
  if (JSON.stringify(results).length > KEPT_ALL) {
    return { results: results.map(({ message: _, ...result }) => result) }
  }
  return { results }
}

// What the calling bot reads of the work: each bot's report.
function reportsFor(output: ParallelOutput) {
  return output.results
    .map((result) => {
      const task = result.taskId
        ? ` on task #${taskRef(result.taskId)} (${result.taskDone ? "done" : "not done"})`
        : ""
      const status =
        result.status === "done"
          ? "reported"
          : result.status === "stopped"
            ? "was stopped"
            : "couldn't finish"
      return `${result.bot}${task} ${status}:\n${result.report}`
    })
    .join("\n\n---\n\n")
}

function voteSummary(output: VoteOutput) {
  const ballots = output.ballots
    .map((ballot) => `- ${ballot.bot}: ${ballot.choice}. ${ballot.reason}`)
    .join("\n")
  const result = !output.decided
    ? "The vote didn't finish."
    : output.outcome
      ? `Decided: ${output.outcome}.`
      : "Tied: nothing was decided."
  return `Vote on "${output.question}". ${result}\n${ballots}`
}

// The calling bot reads reports and results, not the whole work: also on
// later turns, when the history is converted again, and whether or not its
// role still has these tools.
export const collaborationOutputs: ToolSet = {
  [CONSULT_TOOL]: tool({
    inputSchema: z.unknown(),
    toModelOutput: ({ output }) => ({
      type: "text",
      value: reportsFor(output as ParallelOutput),
    }),
  }),
  [DELEGATE_TOOL]: tool({
    inputSchema: z.unknown(),
    toModelOutput: ({ output }) => ({
      type: "text",
      value: reportsFor(output as ParallelOutput),
    }),
  }),
  [VOTE_TOOL]: tool({
    inputSchema: z.unknown(),
    toModelOutput: ({ output }) => ({
      type: "text",
      value: voteSummary(output as VoteOutput),
    }),
  }),
}

// One bot's ballot: its own model and instructions, the constitution, and
// the conversation so far. One that can't vote abstains.
async function castBallot({
  state,
  voter,
  caller,
  question,
  options,
  context,
  transcript,
  abortSignal,
}: {
  state: GroupState
  voter: GroupMember
  caller: GroupMember
  question: string
  options: string[]
  context?: string
  transcript: string
  abortSignal?: AbortSignal
}): Promise<VoteBallot> {
  const ballot = { botId: voter.id, bot: voter.name }
  try {
    const record = await getChatBot(state.id, voter.id)
    const { output } = await generateText({
      model: languageModel(record.model),
      providerOptions: modelProviderOptions(record.model),
      output: Output.object({
        schema: z.object({
          choice: z.enum([ABSTAIN, ...options] as [string, ...string[]]),
          reason: z.string().describe("Why, in one or two sentences"),
        }),
      }),
      system: [
        `You are ${record.name}, a bot in the user's group chat "${state.name ?? "Group chat"}". Your job: ${record.job}.`,
        record.instructions &&
          `The user's instructions for you:\n${record.instructions}`,
        `The group's constitution, which binds you:\n${state.constitution ?? "(None yet.)"}`,
        state.sharedMemory &&
          `The group's shared memory:\n${state.sharedMemory}`,
        `${caller.name} called a vote, and every bot here that may vote casts its ballot now, without seeing the others'. Vote as yourself: from your job and your own judgment, in line with the constitution and what the user wants. Abstain only if the question is outside what you can judge.`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      prompt: [
        `The conversation so far, latest last:\n\n${transcript || "(Nothing yet.)"}`,
        `The vote: ${question}`,
        context && `What ${caller.name} says to weigh: ${context}`,
        `Options: ${options.join("; ")}. Or ${ABSTAIN}.`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      abortSignal,
    })
    return { ...ballot, choice: output.choice, reason: output.reason.trim() }
  } catch {
    return { ...ballot, choice: ABSTAIN, reason: "Couldn't cast a ballot." }
  }
}

// The tools a bot works with others through, for this turn: the ones its
// role allows, less any a moderator has restricted.
export function createCollaborationTools({
  state,
  bot,
  history,
}: {
  state: GroupState
  bot: GroupMember
  history: UIMessage[]
}): ToolSet {
  const chatId = state.id
  const tools: ToolSet = {}
  const others = othersOf(state, bot)
  const names = others.map((other) => `${other.name} (${other.job})`)

  // The bots named, as they are now; each once.
  const pick = (now: GroupState, wanted: string[]) => {
    const available = othersOf(now, bot)
    const picked = wanted.map((name) => {
      const found = available.find((other) => same(other.name, name))
      if (!found) {
        throw new Error(
          `There's no other bot named "${name}" you can set to work. Pick from: ${available.map((other) => other.name).join(", ") || "nobody"}.`
        )
      }
      return found
    })
    if (new Set(picked.map((other) => other.id)).size !== picked.length) {
      throw new Error("Name each bot once, with everything it should do.")
    }
    return picked
  }

  if (can(bot, "consult") && others.length > 0) {
    tools[CONSULT_TOOL] = tool({
      description: `Set other bots in this group to work at the same time, and get their reports back before you reply: to split a job between them, gather their views, or have them check something. Each works on its own, in parallel, with its own tools and the conversation so far, and can't see the others' work. Put everything you want done at once in one call, up to ${MAX_PARALLEL_BOTS} bots, each once. Bots you can ask: ${names.join(", ")}.`,
      inputSchema: z.object({
        asks: z
          .array(
            z.object({
              bot: z.string().describe("The bot's name"),
              request: z
                .string()
                .trim()
                .min(1)
                .max(4000)
                .describe(
                  "What it should do or answer, with whatever it needs to know"
                ),
            })
          )
          .min(1)
          .max(MAX_PARALLEL_BOTS),
      }),
      execute: async ({ asks }, { toolCallId, abortSignal }) => {
        const now = await loadGroupState(chatId)
        const picked = pick(
          now,
          asks.map((ask) => ask.bot)
        )
        return workTogether({
          state: now,
          caller: bot,
          history,
          toolCallId,
          abortSignal,
          assignments: asks.map((ask, index) => ({
            bot: picked[index],
            request: ask.request,
            brief: `${bot.name} asks you:\n\n${ask.request}`,
          })),
        })
      },
      toModelOutput: ({ output }) => ({
        type: "text",
        value: reportsFor(output),
      }),
    })
  }

  if (can(bot, "delegate_tasks") && others.length > 0) {
    tools[DELEGATE_TOOL] = tool({
      description: `Delegate tasks to other bots in this group. Each task goes on the group's task list as theirs, and they start on them at once, in parallel, with their own tools, then report back to you: the task is marked done if its bot says so. Up to ${MAX_PARALLEL_BOTS} bots, one task each. Bots you can delegate to: ${names.join(", ")}.`,
      inputSchema: z.object({
        tasks: z
          .array(
            z.object({
              to: z.string().describe("The bot's name"),
              title: z.string().trim().min(1).max(120),
              details: z
                .string()
                .trim()
                .max(4000)
                .optional()
                .describe("What done looks like, and what it needs to know"),
            })
          )
          .min(1)
          .max(MAX_PARALLEL_BOTS),
      }),
      execute: async ({ tasks }, { toolCallId, abortSignal }) => {
        const now = await loadGroupState(chatId)
        const picked = pick(
          now,
          tasks.map((task) => task.to)
        )
        const created = await db
          .insert(groupTasks)
          .values(
            tasks.map((task, index) => ({
              chatId,
              title: task.title,
              details: task.details,
              proposedBy: bot.id,
              assigneeId: picked[index].id,
              status: "in_progress" as const,
            }))
          )
          .returning({ id: groupTasks.id })
        const output = await workTogether({
          state: await loadGroupState(chatId),
          caller: bot,
          history,
          toolCallId,
          abortSignal,
          assignments: tasks.map((task, index) => ({
            bot: picked[index],
            request: task.title,
            taskId: created[index].id,
            brief: `${bot.name} delegated a task to you, #${taskRef(created[index].id)}: ${task.title}${task.details ? `\n\n${task.details}` : ""}`,
          })),
        })
        await Promise.all(
          output.results.map((result) =>
            result.taskId
              ? db
                  .update(groupTasks)
                  .set({
                    status: result.taskDone ? "done" : "in_progress",
                    result: clip(result.report, TASK_RESULT_CHARS),
                    updatedAt: new Date(),
                  })
                  .where(eq(groupTasks.id, result.taskId))
              : undefined
          )
        )
        return output
      },
      toModelOutput: ({ output }) => ({
        type: "text",
        value: reportsFor(output),
      }),
    })
  }

  const voters = state.members.filter((member) => can(member, "vote"))
  if (can(bot, "call_votes") && voters.length > 0) {
    tools[VOTE_TOOL] = tool({
      description: `Put a question to this group's vote, when it has to decide something it disagrees on or that binds every bot. Every bot that may vote (${voters.map((voter) => voter.name).join(", ")}) casts a ballot at once, with a reason, and you get the result: the option with the most ballots wins, and a tie decides nothing. The result is recorded as the group's decision.`,
      inputSchema: z.object({
        question: z.string().trim().min(1).max(300),
        options: z
          .array(z.string().trim().min(1).max(80))
          .min(2)
          .max(6)
          .optional()
          .describe("The choices. Leave out for Yes and No."),
        context: z
          .string()
          .trim()
          .max(2000)
          .optional()
          .describe("What the voters should weigh"),
      }),
      async *execute({ question, options, context }, { abortSignal }) {
        const now = await loadGroupState(chatId)
        const choices = [
          ...new Set(
            (options ?? ["Yes", "No"]).filter((option) => option !== ABSTAIN)
          ),
        ]
        if (choices.length < 2) throw new Error("Give at least two options.")
        const electorate = now.members.filter((member) => can(member, "vote"))
        if (electorate.length === 0) {
          throw new Error("No bot here may vote right now.")
        }
        const transcript = transcriptOf(
          history,
          new Map(now.members.map((member) => [member.id, member.name]))
        )

        const ballots: VoteBallot[] = []
        const snapshot = (decided: boolean): VoteOutput => ({
          question,
          options: choices,
          ballots: [...ballots],
          waiting: electorate
            .filter((voter) => !ballots.some((b) => b.botId === voter.id))
            .map((voter) => voter.name),
          decided,
          outcome: decided ? outcomeOf(choices, ballots) : null,
        })

        // Ballots come in as they're cast, for the page to show.
        const pending = new Map(
          electorate.map((voter) => [
            voter.id,
            castBallot({
              state: now,
              voter,
              caller: bot,
              question,
              options: choices,
              context,
              transcript,
              abortSignal,
            }),
          ])
        )
        yield snapshot(false)
        while (pending.size > 0) {
          const ballot = await Promise.race(pending.values())
          pending.delete(ballot.botId)
          ballots.push(ballot)
          if (pending.size > 0) yield snapshot(false)
        }

        const result = snapshot(true)
        await db.insert(groupVotes).values({
          chatId,
          calledBy: bot.id,
          question,
          options: choices,
          ballots: ballots.map(({ botId, choice, reason }) => ({
            botId,
            choice,
            reason,
          })),
          outcome: result.outcome,
        })
        yield result
      },
      toModelOutput: ({ output }) => ({
        type: "text",
        value: voteSummary(output),
      }),
    })
  }

  return tools
}
