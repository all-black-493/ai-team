import { and, eq, inArray, ne, sql } from "drizzle-orm"

import { db } from "@/db"
import { agentTurns, type AgentTurn } from "@/db/schema"

export const AUTOMATIC_KINDS = [
  "handoff",
  "flag-response",
  "flag-review",
  "autopilot",
] as const

export type TurnKind = AgentTurn["kind"]

export const MAX_TURN_ATTEMPTS = 3

// A running turn older than this was cut off: its run died or its stream
// was dropped, and it can be picked up again.
export const staleAfterMs = (maxTaskMinutes: number) =>
  (maxTaskMinutes + 2) * 60_000

const isStale = (turn: AgentTurn, maxTaskMinutes: number) =>
  turn.status === "running" &&
  (!turn.startedAt ||
    Date.now() - turn.startedAt.getTime() > staleAfterMs(maxTaskMinutes))

export async function findClaim(chatId: string, afterMessageId: string) {
  return db.query.agentTurns.findFirst({
    where: and(
      eq(agentTurns.chatId, chatId),
      eq(agentTurns.afterMessageId, afterMessageId),
      eq(agentTurns.automatic, true)
    ),
  })
}

// The automatic turn due after `afterMessageId`, claimed once: a turn already
// claimed there is picked up again if it never finished, and refused if it's
// underway or done. Otherwise `decide` picks one, and claims it unless
// another request claimed that point first.
export async function claimAutomaticTurn({
  chatId,
  userId,
  afterMessageId,
  maxTaskMinutes,
  decide,
}: {
  chatId: string
  userId: string
  afterMessageId: string
  maxTaskMinutes: number
  decide: () => Promise<
    { kind: TurnKind; botId: string; reason?: string } | undefined
  >
}) {
  const existing = await findClaim(chatId, afterMessageId)
  if (existing) {
    const recoverable =
      existing.status === "pending" ||
      existing.status === "failed" ||
      isStale(existing, maxTaskMinutes)
    if (!recoverable) {
      await db
        .update(agentTurns)
        .set({ duplicateRequests: sql`${agentTurns.duplicateRequests} + 1` })
        .where(eq(agentTurns.id, existing.id))
      return undefined
    }
    if (existing.attempts >= MAX_TURN_ATTEMPTS) {
      if (existing.status !== "failed") {
        await db
          .update(agentTurns)
          .set({ status: "failed", finishedAt: new Date() })
          .where(eq(agentTurns.id, existing.id))
      }
      return undefined
    }
    const [recovered] = await db
      .update(agentTurns)
      .set({ recoveries: sql`${agentTurns.recoveries} + 1` })
      .where(eq(agentTurns.id, existing.id))
      .returning()
    return recovered
  }

  await db
    .update(agentTurns)
    .set({ status: "stopped", finishedAt: new Date() })
    .where(
      and(
        eq(agentTurns.chatId, chatId),
        eq(agentTurns.automatic, true),
        ne(agentTurns.afterMessageId, afterMessageId),
        inArray(agentTurns.status, ["pending", "failed"])
      )
    )

  const due = await decide()
  if (!due) return undefined
  const [claimed] = await db
    .insert(agentTurns)
    .values({
      chatId,
      userId,
      botId: due.botId,
      kind: due.kind,
      automatic: true,
      afterMessageId,
      reason: due.reason,
    })
    .onConflictDoNothing()
    .returning()
  return claimed
}

// Marks a claimed turn started, or records a turn the user asked for. A
// turn for a message an earlier turn already answered counts as a
// duplicate.
export async function startTurn({
  claimed,
  chatId,
  userId,
  botId,
  kind,
  afterMessageId,
}: {
  claimed?: AgentTurn
  chatId: string
  userId: string
  botId: string
  kind: TurnKind
  afterMessageId: string
}) {
  if (claimed) {
    const [turn] = await db
      .update(agentTurns)
      .set({
        status: "running",
        attempts: sql`${agentTurns.attempts} + 1`,
        startedAt: new Date(),
      })
      .where(eq(agentTurns.id, claimed.id))
      .returning()
    return turn
  }
  const answered =
    kind === "message"
      ? await db.query.agentTurns.findFirst({
          where: and(
            eq(agentTurns.chatId, chatId),
            eq(agentTurns.afterMessageId, afterMessageId),
            eq(agentTurns.kind, "message"),
            inArray(agentTurns.status, ["done", "running"])
          ),
          columns: { id: true },
        })
      : undefined
  const [turn] = await db
    .insert(agentTurns)
    .values({
      chatId,
      userId,
      botId,
      kind,
      afterMessageId,
      status: "running",
      attempts: 1,
      duplicate: Boolean(answered),
      startedAt: new Date(),
    })
    .returning()
  return turn
}

export async function finishTurn(
  turnId: string,
  values: Partial<
    Pick<
      AgentTurn,
      | "status"
      | "inputTokens"
      | "outputTokens"
      | "firstTokenMs"
      | "durationMs"
      | "compacted"
      | "asked"
      | "repeatedQuestion"
    >
  >
) {
  await db
    .update(agentTurns)
    .set({ ...values, finishedAt: new Date() })
    .where(eq(agentTurns.id, turnId))
}

// Automatic turns that were cut off and are worth asking for again: not
// finished, past their first attempt's grace period, in chats that still
// want them.
export async function turnsToRecover(maxTaskMinutes: number) {
  const pendingSince = new Date(Date.now() - 2 * 60_000)
  const runningSince = new Date(Date.now() - staleAfterMs(maxTaskMinutes))
  return db
    .select({ id: agentTurns.id, chatId: agentTurns.chatId })
    .from(agentTurns)
    .where(
      and(
        eq(agentTurns.automatic, true),
        sql`${agentTurns.attempts} < ${MAX_TURN_ATTEMPTS}`,
        sql`(
          (${agentTurns.status} in ('pending', 'failed') and ${agentTurns.createdAt} < ${pendingSince})
          or (${agentTurns.status} = 'running' and ${agentTurns.startedAt} < ${runningSince})
        )`
      )
    )
}
