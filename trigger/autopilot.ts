import { generateText, Output, type UIMessage } from "ai"
import { z } from "zod"

import type { GroupState, PendingTurn } from "@/chats/governance-data"
import { TASK_STATUS_LABELS } from "@/lib/governance"
import { metadataOf, transcriptOf } from "@/trigger/context"
import { languageModel, modelProviderOptions } from "@/trigger/models"
import { taskRef } from "@/trigger/prompt"

// A group on autopilot carries on without the user: after each answer, the
// chat asks for the next turn (components/chat-thread.tsx), and a director
// picks the bot that speaks next, or decides nobody needs to. It's a small,
// fast model: it reads the latest of the conversation and the group's
// tasks, and answers with a name.
const DIRECTOR_MODEL = "claude-haiku-5-5"

const DIRECTOR_SYSTEM = `You direct a group chat of AI bots that work for a user. The group is on autopilot: its bots carry on together without the user, one at a time, and you pick who speaks next, so the conversation flows naturally and the work moves forward.

Pick the bot that should speak next:
- one that was just asked something, addressed by name, or given work;
- one with an open task it can move on, or whose job fits what's needed now;
- not the bot that just spoke, unless it said it would carry on and nobody else has anything to add.

Pick nobody when there's nothing useful left for the bots to do without the user: the work is done, they're waiting on something only the user can give, they're going round in circles, or the last few messages only agree, thank each other or sign off. Stopping is better than bots talking for the sake of it.

Give your reason in one short sentence to the bot you pick, saying what it should do now, such as "Quill asked you to review the draft." For nobody, say why the group can stop.`

// What the director picked for each chat's next turn, from the action that
// asked for it (onAction) to the turn's tools and run. Kept here, not
// worked out again: each pick is a model call, and could come out
// differently.
export const autopilotTurns = new Map<
  string,
  Extract<PendingTurn, { kind: "autopilot" }>
>()

// The bot to speak next on autopilot, and why, or nothing when the group
// can stop. Suspended bots sit it out.
export async function chooseSpeaker(
  state: GroupState,
  history: UIMessage[]
): Promise<Extract<PendingTurn, { kind: "autopilot" }> | undefined> {
  const candidates = state.members.filter((member) => !member.suspendedUntil)
  if (candidates.length === 0) return undefined
  const names = new Map(state.members.map((member) => [member.id, member.name]))
  const lastAnswer = history.findLast((message) => message.role === "assistant")
  const lastSpeaker =
    lastAnswer && names.get(metadataOf(lastAnswer)?.botId ?? "")

  const members = candidates
    .map((member) => `- ${member.name} (${member.role.name}): ${member.job}`)
    .join("\n")
  const tasks = state.tasks
    .filter((task) => task.status === "open" || task.status === "in_progress")
    .map(
      (task) =>
        `- #${taskRef(task.id)} ${task.title} (${TASK_STATUS_LABELS[task.status].toLowerCase()}, ${names.get(task.assigneeId ?? "") ?? "unassigned"})`
    )
    .join("\n")

  const { output } = await generateText({
    model: languageModel(DIRECTOR_MODEL),
    providerOptions: modelProviderOptions(DIRECTOR_MODEL),
    output: Output.object({
      schema: z.object({
        next: z.enum([
          ...new Set(["nobody", ...candidates.map((member) => member.name)]),
        ] as [string, ...string[]]),
        reason: z.string(),
      }),
    }),
    system: DIRECTOR_SYSTEM,
    prompt: [
      `The group "${state.name ?? "Group chat"}" and the bots that can speak:\n${members}`,
      `Open tasks:\n${tasks || "(None.)"}`,
      `The conversation so far, latest last:\n\n${transcriptOf(history, names) || "(Nothing yet.)"}`,
      lastSpeaker
        ? `${lastSpeaker} spoke last. Who speaks next?`
        : "Who speaks first?",
    ].join("\n\n"),
  })

  const next = candidates.find((member) => member.name === output.next)
  if (!next) return undefined
  return { kind: "autopilot", botId: next.id, reason: output.reason.trim() }
}
