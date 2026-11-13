import "server-only"

import { auth } from "@clerk/nextjs/server"
import { and, eq, gte, inArray, sql } from "drizzle-orm"

import { liveIssue } from "@/chats/knowledge-data"
import { db } from "@/db"
import {
  agentTurns,
  bots,
  chats,
  chatSummaries,
  knowledgeChunks,
  knowledgeCollections,
  knowledgeDocuments,
  knowledgeIssues,
  knowledgeRetrievals,
  memoryRetrievals,
  sandboxEvents,
  botMemories,
} from "@/db/schema"
import {
  SANDBOX_DEFAULTS,
  SANDBOX_RATES,
  SANDBOX_SIZE,
} from "@/lib/sandbox-policy"

const WINDOW_DAYS = 30

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null)

// Sandbox running hours, from the times each was in use: a run of activity
// keeps it up, and it stops itself once idle for its auto-stop minutes.
function runningHours(
  events: { sandboxId: string; at: Date; autoStopMinutes: number }[]
) {
  const bySandbox = Map.groupBy(events, (event) => event.sandboxId)
  let hours = 0
  for (const list of bySandbox.values()) {
    const times = list
      .map((event) => event.at.getTime())
      .toSorted((a, b) => a - b)
    const idle =
      (list[0]?.autoStopMinutes ?? SANDBOX_DEFAULTS.autoStopMinutes) * 60_000
    let start = times[0]
    let last = times[0]
    for (const time of times.slice(1)) {
      if (time - last > idle) {
        hours += (last - start + idle) / 3_600_000
        start = time
      }
      last = time
    }
    if (start !== undefined) hours += (last - start + idle) / 3_600_000
  }
  return hours
}

export async function getMetrics() {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) return null
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3_600_000)

  const turns = and(
    eq(agentTurns.userId, userId),
    gte(agentTurns.createdAt, since)
  )
  const [turnStats] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      automatic:
        sql<number>`count(*) filter (where ${agentTurns.automatic})`.mapWith(
          Number
        ),
      interrupted:
        sql<number>`count(*) filter (where ${agentTurns.automatic} and (${agentTurns.recoveries} > 0 or ${agentTurns.status} = 'failed'))`.mapWith(
          Number
        ),
      recovered:
        sql<number>`count(*) filter (where ${agentTurns.automatic} and ${agentTurns.recoveries} > 0 and ${agentTurns.status} = 'done')`.mapWith(
          Number
        ),
      duplicates:
        sql<number>`count(*) filter (where ${agentTurns.duplicate})`.mapWith(
          Number
        ),
      refused:
        sql<number>`coalesce(sum(${agentTurns.duplicateRequests}), 0)`.mapWith(
          Number
        ),
      asked: sql<number>`count(*) filter (where ${agentTurns.asked})`.mapWith(
        Number
      ),
      repeated:
        sql<number>`count(*) filter (where ${agentTurns.repeatedQuestion})`.mapWith(
          Number
        ),
    })
    .from(agentTurns)
    .where(turns)

  const contextStats = await db
    .select({
      compacted: agentTurns.compacted,
      turns: sql<number>`count(*)`.mapWith(Number),
      inputTokens: sql<number | null>`avg(${agentTurns.inputTokens})`.mapWith(
        Number
      ),
      firstTokenMs: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${agentTurns.firstTokenMs})`.mapWith(
        Number
      ),
    })
    .from(agentTurns)
    .where(and(turns, eq(agentTurns.status, "done")))
    .groupBy(agentTurns.compacted)
  const contextOf = (compacted: boolean) =>
    contextStats.find((row) => row.compacted === compacted)

  const [summaries] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(chatSummaries)
    .innerJoin(chats, eq(chats.id, chatSummaries.chatId))
    .where(and(eq(chats.userId, userId), gte(chatSummaries.createdAt, since)))

  const events = and(
    eq(sandboxEvents.userId, userId),
    gte(sandboxEvents.createdAt, since)
  )
  const [sandboxStats] = await db
    .select({
      calls: sql<number>`count(*)`.mapWith(Number),
      errors:
        sql<number>`count(*) filter (where not ${sandboxEvents.ok})`.mapWith(
          Number
        ),
      coldStarts:
        sql<number>`count(*) filter (where ${sandboxEvents.cold} and ${sandboxEvents.action} = 'start' and ${sandboxEvents.ok})`.mapWith(
          Number
        ),
      startP50: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${sandboxEvents.durationMs}) filter (where ${sandboxEvents.cold} and ${sandboxEvents.action} = 'start' and ${sandboxEvents.ok})`.mapWith(
        Number
      ),
      startP95: sql<
        number | null
      >`percentile_cont(0.95) within group (order by ${sandboxEvents.durationMs}) filter (where ${sandboxEvents.cold} and ${sandboxEvents.action} = 'start' and ${sandboxEvents.ok})`.mapWith(
        Number
      ),
    })
    .from(sandboxEvents)
    .where(events)
  const activity = await db
    .select({
      sandboxId: sandboxEvents.sandboxId,
      at: sandboxEvents.createdAt,
      autoStopMinutes:
        sql<number>`coalesce(${bots.autoStopMinutes}, ${SANDBOX_DEFAULTS.autoStopMinutes})`.mapWith(
          Number
        ),
    })
    .from(sandboxEvents)
    .leftJoin(bots, eq(bots.id, sandboxEvents.botId))
    .where(and(events, eq(sandboxEvents.ok, true)))
  const hours = runningHours(activity)

  const ownBots = db
    .select({ id: bots.id })
    .from(bots)
    .where(eq(bots.userId, userId))
  const [memoryStats] = await db
    .select({
      judged:
        sql<number>`count(*) filter (where ${memoryRetrievals.used} is not null)`.mapWith(
          Number
        ),
      used: sql<number>`count(*) filter (where ${memoryRetrievals.used})`.mapWith(
        Number
      ),
    })
    .from(memoryRetrievals)
    .where(
      and(
        inArray(memoryRetrievals.botId, ownBots),
        gte(memoryRetrievals.createdAt, since)
      )
    )
  const [notes] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(botMemories)
    .where(
      and(
        inArray(botMemories.botId, ownBots),
        eq(botMemories.current, true),
        eq(botMemories.deleted, false)
      )
    )

  const ownCollections = db
    .select({ id: knowledgeCollections.id })
    .from(knowledgeCollections)
    .where(eq(knowledgeCollections.userId, userId))
  const [library] = await db
    .select({
      documents:
        sql<number>`count(distinct ${knowledgeChunks.documentId})`.mapWith(
          Number
        ),
      passages: sql<number>`count(*)`.mapWith(Number),
    })
    .from(knowledgeChunks)
    .where(
      and(
        inArray(knowledgeChunks.collectionId, ownCollections),
        eq(knowledgeChunks.current, true)
      )
    )
  const [openIssues] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(knowledgeIssues)
    .where(
      and(
        inArray(knowledgeIssues.collectionId, ownCollections),
        eq(knowledgeIssues.status, "open"),
        liveIssue
      )
    )
  const [stale] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(knowledgeDocuments)
    .innerJoin(
      knowledgeCollections,
      eq(knowledgeCollections.id, knowledgeDocuments.collectionId)
    )
    .where(
      and(
        eq(knowledgeCollections.userId, userId),
        eq(knowledgeDocuments.archived, false),
        sql`${knowledgeDocuments.updatedAt} < now() - make_interval(days => ${knowledgeCollections.reviewAfterDays})`
      )
    )
  const lookups = and(
    eq(knowledgeRetrievals.userId, userId),
    gte(knowledgeRetrievals.createdAt, since)
  )
  const [retrievalStats] = await db
    .select({
      lookups: sql<number>`count(*)`.mapWith(Number),
      found:
        sql<number>`count(*) filter (where cardinality(${knowledgeRetrievals.chunkIds}) > 0)`.mapWith(
          Number
        ),
      latency: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${knowledgeRetrievals.durationMs})`.mapWith(
        Number
      ),
    })
    .from(knowledgeRetrievals)
    .where(lookups)
  const [citationStats] = await db
    .select({
      answers: sql<number>`count(*)`.mapWith(Number),
      cited: sql<number>`count(*) filter (where cited > 0)`.mapWith(Number),
    })
    .from(
      db
        .select({
          turnId: knowledgeRetrievals.turnId,
          cited: sql<number>`sum(${knowledgeRetrievals.cited})`.as("cited"),
        })
        .from(knowledgeRetrievals)
        .where(
          and(
            lookups,
            sql`${knowledgeRetrievals.turnId} is not null`,
            sql`${knowledgeRetrievals.cited} is not null`,
            sql`cardinality(${knowledgeRetrievals.chunkIds}) > 0`
          )
        )
        .groupBy(knowledgeRetrievals.turnId)
        .as("answers")
    )

  return {
    days: WINDOW_DAYS,
    knowledge: {
      documents: library.documents,
      passages: library.passages,
      stale: stale.count,
      openIssues: openIssues.count,
      lookups: retrievalStats.lookups,
      hitRate: ratio(retrievalStats.found, retrievalStats.lookups),
      latencyMs: retrievalStats.latency,
      answers: citationStats.answers,
      citationRate: ratio(citationStats.cited, citationStats.answers),
    },
    autopilot: {
      automaticTurns: turnStats.automatic,
      interrupted: turnStats.interrupted,
      recoveryRate: ratio(turnStats.recovered, turnStats.interrupted),
      turns: turnStats.total,
      duplicateRate: ratio(turnStats.duplicates, turnStats.total),
      refusedDuplicates: turnStats.refused,
    },
    sandboxes: {
      coldStarts: sandboxStats.coldStarts,
      startP50: sandboxStats.startP50,
      startP95: sandboxStats.startP95,
      calls: sandboxStats.calls,
      errorRate: ratio(sandboxStats.errors, sandboxStats.calls),
      runningHours: hours,
      cost:
        hours *
        (SANDBOX_SIZE.vcpu * SANDBOX_RATES.vcpuHour +
          SANDBOX_SIZE.memoryGiB * SANDBOX_RATES.memoryGiBHour),
    },
    context: {
      summaries: summaries.count,
      full: contextOf(false),
      compacted: contextOf(true),
    },
    memory: {
      notes: notes.count,
      retrievals: memoryStats.judged,
      accuracy: ratio(memoryStats.used, memoryStats.judged),
      asked: turnStats.asked,
      repeatedRate: ratio(turnStats.repeated, turnStats.asked),
    },
  }
}

export type Metrics = NonNullable<Awaited<ReturnType<typeof getMetrics>>>
