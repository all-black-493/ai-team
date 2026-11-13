import { and, arrayOverlaps, desc, eq, inArray, or, sql } from "drizzle-orm"

import { db } from "@/db"
import { botMemories, memoryRetrievals, type BotMemory } from "@/db/schema"

type Note = Pick<BotMemory, "key" | "category" | "content" | "tags">

const STOP_WORDS = new Set(
  "the and for are but not you your with this that have has had was were what when where which who whom why how can could would should will just about into from they them their there here then than also been being does did doing done its it's our out over own same some such very only other more most any all each few both too off once again further while because until".split(
    " "
  )
)

// The words that carry meaning: lowercase, three letters or more.
export function wordsOf(text: string) {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    ),
  ]
}

export function keyOf(key: string) {
  return (
    key
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "note"
  )
}

export async function rememberNote(botId: string, note: Note, chatId?: string) {
  const key = keyOf(note.key)
  return db.transaction(async (tx) => {
    const [previous] = await tx
      .update(botMemories)
      .set({ current: false })
      .where(
        and(
          eq(botMemories.botId, botId),
          eq(botMemories.key, key),
          eq(botMemories.current, true)
        )
      )
      .returning({ version: botMemories.version })
    const [saved] = await tx
      .insert(botMemories)
      .values({
        ...note,
        key,
        botId,
        chatId,
        version: (previous?.version ?? 0) + 1,
      })
      .returning()
    return saved
  })
}

export async function forgetNote(botId: string, key: string, chatId?: string) {
  const slug = keyOf(key)
  return db.transaction(async (tx) => {
    const [previous] = await tx
      .update(botMemories)
      .set({ current: false })
      .where(
        and(
          eq(botMemories.botId, botId),
          eq(botMemories.key, slug),
          eq(botMemories.current, true),
          eq(botMemories.deleted, false)
        )
      )
      .returning()
    if (!previous) return undefined
    const [tombstone] = await tx
      .insert(botMemories)
      .values({
        botId,
        key: slug,
        category: previous.category,
        content: previous.content,
        tags: previous.tags,
        version: previous.version + 1,
        deleted: true,
        chatId,
      })
      .returning()
    return tombstone
  })
}

const document = sql`to_tsvector('english', ${botMemories.key} || ' ' || ${botMemories.content})`

// The current notes best matching any of the query's words, ranked.
export async function searchMemories(
  botId: string,
  query: string,
  {
    category,
    limit = 5,
  }: { category?: BotMemory["category"]; limit?: number } = {}
) {
  const words = wordsOf(query).slice(0, 16)
  if (words.length === 0) return []
  const tsquery = words.join(" | ")
  const rank = sql<number>`ts_rank(${document}, to_tsquery('english', ${tsquery}))`
  return db
    .select({
      id: botMemories.id,
      key: botMemories.key,
      category: botMemories.category,
      content: botMemories.content,
      tags: botMemories.tags,
      version: botMemories.version,
      createdAt: botMemories.createdAt,
      rank,
    })
    .from(botMemories)
    .where(
      and(
        eq(botMemories.botId, botId),
        eq(botMemories.current, true),
        eq(botMemories.deleted, false),
        category ? eq(botMemories.category, category) : undefined,
        or(
          sql`${document} @@ to_tsquery('english', ${tsquery})`,
          arrayOverlaps(botMemories.tags, words)
        )
      )
    )
    .orderBy(desc(rank), desc(botMemories.createdAt))
    .limit(limit)
}

// What a bot knows about the user and how they like things done, newest
// first: worth having in every turn.
export async function profileNotes(botId: string, limit = 5) {
  return db.query.botMemories.findMany({
    where: and(
      eq(botMemories.botId, botId),
      eq(botMemories.current, true),
      eq(botMemories.deleted, false),
      inArray(botMemories.category, ["user", "preference"])
    ),
    orderBy: [desc(botMemories.createdAt)],
    limit,
  })
}

export async function noteHistory(botId: string, key: string) {
  return db.query.botMemories.findMany({
    where: and(eq(botMemories.botId, botId), eq(botMemories.key, keyOf(key))),
    orderBy: [desc(botMemories.version)],
  })
}

export async function logRetrieval(values: {
  botId: string
  chatId: string
  turnId?: string
  source: "auto" | "recall"
  query: string
  memoryIds: string[]
}) {
  await db.insert(memoryRetrievals).values({
    ...values,
    query: values.query.slice(0, 500),
  })
}

// Whether an answer drew on a note: they share several meaningful words.
function usedIn(answer: Set<string>, content: string) {
  const words = wordsOf(content)
  const shared = words.filter((word) => answer.has(word)).length
  return shared >= Math.min(3, Math.max(1, Math.ceil(words.length / 2)))
}

export async function judgeRetrievals(turnId: string, answer: string) {
  const retrievals = await db.query.memoryRetrievals.findMany({
    where: eq(memoryRetrievals.turnId, turnId),
  })
  const found = retrievals.filter((retrieval) => retrieval.memoryIds.length > 0)
  if (found.length === 0) return
  const notes = await db.query.botMemories.findMany({
    where: inArray(
      botMemories.id,
      found.flatMap((retrieval) => retrieval.memoryIds)
    ),
    columns: { id: true, content: true },
  })
  const words = new Set(wordsOf(answer))
  for (const retrieval of found) {
    const used = notes.some(
      (note) =>
        retrieval.memoryIds.includes(note.id) && usedIn(words, note.content)
    )
    await db
      .update(memoryRetrievals)
      .set({ used })
      .where(eq(memoryRetrievals.id, retrieval.id))
  }
}

// The questions in an answer, and whether the bot's memory already held
// the answer to one of them.
export async function questionsIn(botId: string, answer: string) {
  const questions = (answer.match(/[^.!?\n]*\?/g) ?? [])
    .map((question) => question.trim())
    .filter((question) => wordsOf(question).length >= 2)
    .slice(0, 3)
  if (questions.length === 0) return { asked: false, repeated: false }
  for (const question of questions) {
    const [best] = await searchMemories(botId, question, { limit: 1 })
    const asked = new Set(wordsOf(question))
    if (
      best &&
      wordsOf(`${best.key} ${best.content}`).filter((word) => asked.has(word))
        .length >= 2
    ) {
      return { asked: true, repeated: true }
    }
  }
  return { asked: true, repeated: false }
}
