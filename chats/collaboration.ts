import { getToolName, isToolUIPart, type UIMessage } from "ai"

import { ABSTAIN } from "@/lib/governance"

// How a group's bots work together beyond handing a message on: several at
// once, on a consult or delegate call, and deciding by vote. Shared by the
// agent (trigger/collaboration.ts) and the chat, so it holds data only.

// A bot asks others to work on something at once, and gets their reports.
export const CONSULT_TOOL = "consult"
// An admin gives others tasks of their own, which they do at once.
export const DELEGATE_TOOL = "delegate"
// A bot puts a question to the group, and every bot that may vote does.
export const VOTE_TOOL = "call_vote"
// What a bot working on a delegated task calls once it has.
export const FINISH_TASK_TOOL = "finish_task"

// Both set bots to work at once, and show each one's work as it happens.
export const PARALLEL_TOOLS = [CONSULT_TOOL, DELEGATE_TOOL]

// How one bot's work went: finished, broke, or stopped with the turn.
export type WorkStatus = "done" | "failed" | "stopped"

export type WorkResult = {
  botId: string
  bot: string
  // What it was asked to do: a consult's request, or a task's title.
  request: string
  // A delegated task's ID, and whether its bot said it's done.
  taskId?: string
  taskDone?: boolean
  status: WorkStatus
  // Its report: the end of its answer, or what went wrong.
  report: string
  // Its whole answer, tool calls and all, for the page to show.
  message?: UIMessage
}

export type ParallelOutput = { results: WorkResult[] }

export type VoteBallot = {
  botId: string
  bot: string
  choice: string
  reason: string
}

// A vote as it comes in, and once decided: `outcome` is the winning option,
// or null for a tie. `waiting` are the bots yet to cast their ballot.
export type VoteOutput = {
  question: string
  options: string[]
  ballots: VoteBallot[]
  waiting: string[]
  decided: boolean
  outcome: string | null
}

// Where the page finds the live answer of the bot doing a call's
// `index`-th piece of work, as it streams in.
export const workKey = (toolCallId: string, index: number) =>
  `${toolCallId}:${index}`

// Ballots per option, abstentions apart, in the options' order.
export function tally(options: string[], ballots: { choice: string }[]) {
  return [...options, ABSTAIN].map((option) => ({
    option,
    votes: ballots.filter((ballot) => ballot.choice === option).length,
  }))
}

// The option with the most ballots, or null when none has more than every
// other, or nobody chose one.
export function outcomeOf(options: string[], ballots: { choice: string }[]) {
  const counts = tally(options, ballots).filter(
    (count) => count.option !== ABSTAIN && count.votes > 0
  )
  const most = Math.max(0, ...counts.map((count) => count.votes))
  const leaders = counts.filter((count) => count.votes === most)
  return leaders.length === 1 ? leaders[0].option : null
}

// The finished collaboration calls in a bot's answer: what it set others to
// do and what came back, and the votes it called.
export function collaborationOf(message: UIMessage | undefined) {
  const work: ParallelOutput[] = []
  const votes: VoteOutput[] = []
  if (message?.role !== "assistant") return { work, votes }
  for (const part of message.parts) {
    if (
      !isToolUIPart(part) ||
      part.state !== "output-available" ||
      part.preliminary
    ) {
      continue
    }
    const name = getToolName(part)
    if (PARALLEL_TOOLS.includes(name)) work.push(part.output as ParallelOutput)
    if (name === VOTE_TOOL) votes.push(part.output as VoteOutput)
  }
  return { work, votes }
}
