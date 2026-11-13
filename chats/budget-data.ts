import type { LanguageModelUsage } from "ai"
import { and, eq, gte, sql } from "drizzle-orm"

import { db } from "@/db"
import {
  chatEvents,
  modelUsage,
  userSettings,
  type ChatEvent,
} from "@/db/schema"
import { costOf, DEFAULT_LIMITS, type Limits } from "@/lib/budget"

// Not scoped to a signed-in user, so callers check who's asking first. No
// "server-only" guard: the Trigger.dev agent imports this too.

const DEFAULTS: Limits = {
  ...DEFAULT_LIMITS,
  approveFileDeletes: true,
  approveCodePushes: true,
  approveRoleChanges: true,
  approveIntegrations: true,
}

export async function loadLimits(userId: string): Promise<Limits> {
  const row = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
    columns: { userId: false, updatedAt: false },
  })
  return row ?? DEFAULTS
}

const startOfDay = () => {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
}

const total = sql<number>`coalesce(sum(${modelUsage.cost}), 0)`.mapWith(Number)

export async function spendOf(userId: string, chatId: string) {
  const [[chat], [user], [day]] = await Promise.all([
    db.select({ total }).from(modelUsage).where(eq(modelUsage.chatId, chatId)),
    db.select({ total }).from(modelUsage).where(eq(modelUsage.userId, userId)),
    db
      .select({ total })
      .from(modelUsage)
      .where(
        and(
          eq(modelUsage.userId, userId),
          gte(modelUsage.createdAt, startOfDay())
        )
      ),
  ])
  return { chat: chat.total, user: user.total, day: day.total }
}

export async function recordUsage(values: {
  userId: string
  chatId?: string | null
  botId?: string | null
  kind: (typeof modelUsage.$inferInsert)["kind"]
  model: string
  usage: LanguageModelUsage
}) {
  const cost = costOf(values.model, values.usage)
  await db.insert(modelUsage).values({
    userId: values.userId,
    chatId: values.chatId ?? null,
    botId: values.botId ?? null,
    kind: values.kind,
    model: values.model,
    inputTokens: values.usage.inputTokens ?? 0,
    outputTokens: values.usage.outputTokens ?? 0,
    cost,
  })
  return cost
}

export async function recordEvent(
  values: Pick<ChatEvent, "chatId" | "category" | "title"> &
    Partial<Pick<ChatEvent, "botId" | "byUser" | "detail" | "cost">>
) {
  await db.insert(chatEvents).values({
    ...values,
    detail: values.detail ? values.detail.slice(0, 2000) : null,
  })
}
