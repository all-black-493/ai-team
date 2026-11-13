import {
  and,
  cosineDistance,
  desc,
  eq,
  inArray,
  isNotNull,
  or,
  sql,
} from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { del } from "@vercel/blob"

import { wordsOf } from "@/chats/memory-data"
import { db } from "@/db"
import {
  chatMembers,
  chats,
  collectionBots,
  knowledgeChunks,
  knowledgeCollections,
  knowledgeDocuments,
  knowledgeIssues,
  knowledgeRetrievals,
  knowledgeVersions,
  modelUsage,
} from "@/db/schema"
import { embeddingCost, embedQuery } from "@/lib/embeddings"
import {
  CITATION,
  EMBEDDING,
  isStale,
  KNOWLEDGE_KIND_LABELS,
  type IssueKind,
  type KnowledgeKind,
  type SearchMode,
} from "@/lib/knowledge"

export type Passage = {
  chunkId: string
  documentId: string
  collectionId: string
  collection: string
  title: string
  kind: KnowledgeKind
  section: string
  content: string
  version: number
  updatedAt: Date
  stale: boolean
  similarity: number | null
  score: number
}

export type PassageIssue = {
  kind: IssueKind
  summary: string
  chunkId: string
  otherChunkId: string
  title: string
  otherTitle: string
  otherSection: string
  newer: string | null
}

export type Source = {
  ref: number
  chunkId: string
  documentId: string
  collectionId: string
  title: string
  section: string
  version: number
  kind: KnowledgeKind
  stale: boolean
  excerpt: string
}

export type KnowledgeData = {
  sources: Source[]
  issues: { refs: number[]; kind: IssueKind; summary: string }[]
}

const SEARCH_TEXT = sql`to_tsvector('english', ${knowledgeChunks.section} || ' ' || ${knowledgeChunks.content})`
const CANDIDATES = 40
const RRF_K = 60

export async function recordEmbeddingUsage(
  userId: string,
  tokens: number,
  chatId?: string | null
) {
  if (tokens <= 0) return
  await db
    .insert(modelUsage)
    .values({
      userId,
      chatId: chatId ?? null,
      kind: "embedding",
      model: EMBEDDING.model,
      inputTokens: tokens,
      outputTokens: 0,
      cost: embeddingCost(tokens),
    })
    .catch((error) => console.error("Couldn't record embedding usage", error))
}

// The collections a bot may read: those the user gave it, and in a group
// chat it belongs to, that group's shared collection.
export async function accessibleCollections(botId: string, chatId?: string) {
  const granted = db
    .select({ id: collectionBots.collectionId })
    .from(collectionBots)
    .where(eq(collectionBots.botId, botId))
  const groups = chatId
    ? db
        .select({ id: chatMembers.chatId })
        .from(chatMembers)
        .innerJoin(chats, eq(chats.id, chatMembers.chatId))
        .where(
          and(
            eq(chatMembers.chatId, chatId),
            eq(chatMembers.botId, botId),
            eq(chats.kind, "group")
          )
        )
    : undefined
  return db
    .select({
      id: knowledgeCollections.id,
      name: knowledgeCollections.name,
      groupChatId: knowledgeCollections.groupChatId,
    })
    .from(knowledgeCollections)
    .where(
      or(
        inArray(knowledgeCollections.id, granted),
        groups ? inArray(knowledgeCollections.groupChatId, groups) : undefined
      )
    )
}

function keywordQuery(query: string, mode: SearchMode) {
  if (mode === "keyword") return sql`websearch_to_tsquery('english', ${query})`
  const words = wordsOf(query).slice(0, 24)
  return words.length > 0
    ? sql`to_tsquery('english', ${words.join(" | ")})`
    : undefined
}

const passageColumns = {
  chunkId: knowledgeChunks.id,
  documentId: knowledgeChunks.documentId,
  collectionId: knowledgeChunks.collectionId,
  collection: knowledgeCollections.name,
  reviewAfterDays: knowledgeCollections.reviewAfterDays,
  title: knowledgeDocuments.title,
  kind: knowledgeDocuments.kind,
  updatedAt: knowledgeDocuments.updatedAt,
  section: knowledgeChunks.section,
  content: knowledgeChunks.content,
  version: knowledgeVersions.version,
}

// Hybrid search over the current passages of some collections: semantic
// (vector) and keyword (full text) candidates fused by reciprocal rank. The
// keyword search runs while the query is embedded. `minSimilarity` keeps only
// passages among the closest in meaning and at least that similar.
export async function searchKnowledge({
  collectionIds,
  query,
  mode = "hybrid",
  limit = 6,
  minSimilarity,
  signal,
}: {
  collectionIds: string[]
  query: string
  mode?: SearchMode
  limit?: number
  minSimilarity?: number
  signal?: AbortSignal
}): Promise<{ passages: Passage[]; tokens: number }> {
  const text = query.trim().slice(0, 2000)
  if (collectionIds.length === 0 || !text) return { passages: [], tokens: 0 }

  const scope = and(
    eq(knowledgeChunks.current, true),
    inArray(knowledgeChunks.collectionId, collectionIds)
  )
  const tsquery = mode === "semantic" ? undefined : keywordQuery(text, mode)

  const keywordSearch = tsquery
    ? db
        .select({ ...passageColumns, distance: sql<null>`null` })
        .from(knowledgeChunks)
        .innerJoin(
          knowledgeDocuments,
          eq(knowledgeDocuments.id, knowledgeChunks.documentId)
        )
        .innerJoin(
          knowledgeVersions,
          eq(knowledgeVersions.id, knowledgeChunks.versionId)
        )
        .innerJoin(
          knowledgeCollections,
          eq(knowledgeCollections.id, knowledgeChunks.collectionId)
        )
        .where(and(scope, sql`${SEARCH_TEXT} @@ ${tsquery}`))
        .orderBy(desc(sql`ts_rank_cd(${SEARCH_TEXT}, ${tsquery})`))
        .limit(CANDIDATES)
    : Promise.resolve([])

  const semanticSearch =
    mode === "keyword"
      ? Promise.resolve({ rows: [], tokens: 0 })
      : embedQuery(text, signal).then(async ({ embedding, tokens }) => {
          const distance = cosineDistance(knowledgeChunks.embedding, embedding)
          const rows = await db.transaction(async (tx) => {
            await tx.execute(sql`SET LOCAL lakebase_ann.prefilter = on`)
            return tx
              .select({
                ...passageColumns,
                distance: sql<number>`${distance}`.mapWith(Number),
              })
              .from(knowledgeChunks)
              .innerJoin(
                knowledgeDocuments,
                eq(knowledgeDocuments.id, knowledgeChunks.documentId)
              )
              .innerJoin(
                knowledgeVersions,
                eq(knowledgeVersions.id, knowledgeChunks.versionId)
              )
              .innerJoin(
                knowledgeCollections,
                eq(knowledgeCollections.id, knowledgeChunks.collectionId)
              )
              .where(scope)
              .orderBy(distance)
              .limit(CANDIDATES)
          })
          return { rows, tokens }
        })

  const [keyword, semantic] = await Promise.all([keywordSearch, semanticSearch])

  type Row = (typeof keyword)[number] | (typeof semantic.rows)[number]
  type Found = Omit<Row, "distance"> & {
    similarity: number | null
    score: number
  }
  const found = new Map<string, Found>()
  const add = (rows: Row[]) =>
    rows.forEach(({ distance, ...row }, index) => {
      const known = found.get(row.chunkId)
      found.set(row.chunkId, {
        ...row,
        similarity:
          distance === null ? (known?.similarity ?? null) : 1 - distance,
        score: (known?.score ?? 0) + 1 / (RRF_K + index + 1),
      })
    })
  add(semantic.rows)
  add(keyword)

  const passages = [...found.values()]
    .filter(
      (passage) =>
        minSimilarity === undefined ||
        (passage.similarity !== null && passage.similarity >= minSimilarity)
    )
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ reviewAfterDays, ...passage }) => ({
      ...passage,
      stale: isStale(passage.updatedAt, reviewAfterDays),
    }))
  return { passages, tokens: semantic.tokens }
}

// Open problems that touch any of these passages: the other side may not
// have been retrieved.
export async function issuesFor(chunkIds: string[]): Promise<PassageIssue[]> {
  if (chunkIds.length === 0) return []
  const otherDocument = alias(knowledgeDocuments, "other_document")
  const otherChunk = alias(knowledgeChunks, "other_chunk")
  const thisChunk = alias(knowledgeChunks, "this_chunk")
  const rows = await db
    .select({
      kind: knowledgeIssues.kind,
      summary: knowledgeIssues.summary,
      chunkId: knowledgeIssues.chunkId,
      otherChunkId: knowledgeIssues.otherChunkId,
      documentId: knowledgeIssues.documentId,
      title: knowledgeDocuments.title,
      otherTitle: otherDocument.title,
      otherSection: otherChunk.section,
      newerDocumentId: knowledgeIssues.newerDocumentId,
    })
    .from(knowledgeIssues)
    .innerJoin(
      knowledgeDocuments,
      eq(knowledgeDocuments.id, knowledgeIssues.documentId)
    )
    .innerJoin(
      otherDocument,
      eq(otherDocument.id, knowledgeIssues.otherDocumentId)
    )
    .innerJoin(otherChunk, eq(otherChunk.id, knowledgeIssues.otherChunkId))
    .innerJoin(thisChunk, eq(thisChunk.id, knowledgeIssues.chunkId))
    .where(
      and(
        eq(knowledgeIssues.status, "open"),
        eq(thisChunk.current, true),
        eq(otherChunk.current, true),
        or(
          inArray(knowledgeIssues.chunkId, chunkIds),
          inArray(knowledgeIssues.otherChunkId, chunkIds)
        )
      )
    )
    .limit(10)
  return rows.map(({ newerDocumentId, documentId, ...row }) => ({
    ...row,
    newer:
      newerDocumentId === null
        ? null
        : newerDocumentId === documentId
          ? row.title
          : row.otherTitle,
  }))
}

// Numbers each passage a bot sees in a turn, so its answer can cite it.
export class SourceRegistry {
  private refs = new Map<string, Source>()

  add(passages: Passage[]) {
    return passages.map((passage) => {
      const known = this.refs.get(passage.chunkId)
      if (known) return known
      const source: Source = {
        ref: this.refs.size + 1,
        chunkId: passage.chunkId,
        documentId: passage.documentId,
        collectionId: passage.collectionId,
        title: passage.title,
        section: passage.section,
        version: passage.version,
        kind: passage.kind,
        stale: passage.stale,
        excerpt: passage.content.slice(0, 280),
      }
      this.refs.set(passage.chunkId, source)
      return source
    })
  }

  refOf(chunkId: string) {
    return this.refs.get(chunkId)?.ref
  }

  cited(text: string) {
    const numbers = new Set(
      [...text.matchAll(CITATION)].map((match) => Number(match[1]))
    )
    return [...this.refs.values()]
      .filter((source) => numbers.has(source.ref))
      .map((source) => source.chunkId)
  }
}

const day = (date: Date) => date.toISOString().slice(0, 10)

export function describePassages(passages: Passage[], sources: SourceRegistry) {
  return passages
    .map((passage) => {
      const ref = sources.refOf(passage.chunkId)
      const facts = [
        KNOWLEDGE_KIND_LABELS[passage.kind],
        `collection "${passage.collection}"`,
        `version ${passage.version}`,
        `updated ${day(passage.updatedAt)}`,
        passage.stale && "due for review, may be outdated",
      ].filter(Boolean)
      return `[${ref}] ${passage.title} — ${passage.section} (${facts.join(", ")})\n<passage>\n${passage.content}\n</passage>`
    })
    .join("\n\n")
}

export function describeIssues(
  issues: PassageIssue[],
  sources: SourceRegistry
) {
  return issues
    .map((issue) => {
      const ref = sources.refOf(issue.chunkId)
      const otherRef = sources.refOf(issue.otherChunkId)
      const one = ref ? `[${ref}]` : `"${issue.title}"`
      const other = otherRef
        ? `[${otherRef}]`
        : `"${issue.otherTitle}" (${issue.otherSection})`
      const verb =
        issue.kind === "duplicate"
          ? "repeats"
          : issue.kind === "superseded"
            ? "may be replaced by"
            : "disagrees with"
      const newer = issue.newer ? ` "${issue.newer}" looks newer.` : ""
      return `- ${one} ${verb} ${other}: ${issue.summary}${newer}`
    })
    .join("\n")
}

export function knowledgeData(
  sources: Source[],
  issues: PassageIssue[],
  registry: SourceRegistry
): KnowledgeData {
  return {
    sources,
    issues: issues
      .map((issue) => ({
        refs: [
          registry.refOf(issue.chunkId),
          registry.refOf(issue.otherChunkId),
        ].filter((ref): ref is number => ref !== undefined),
        kind: issue.kind,
        summary: issue.summary,
      }))
      .filter((issue) => issue.refs.length > 0),
  }
}

export async function logKnowledgeRetrieval(values: {
  userId: string
  botId?: string | null
  chatId?: string | null
  turnId?: string
  source: "auto" | "search"
  query: string
  chunkIds: string[]
  durationMs?: number
}) {
  await db
    .insert(knowledgeRetrievals)
    .values({ ...values, query: values.query.slice(0, 1000) })
    .catch((error) =>
      console.error("Couldn't log a knowledge retrieval", error)
    )
}

export async function scoreCitations(turnId: string, citedChunkIds: string[]) {
  const rows = await db
    .select({
      id: knowledgeRetrievals.id,
      chunkIds: knowledgeRetrievals.chunkIds,
    })
    .from(knowledgeRetrievals)
    .where(
      and(
        eq(knowledgeRetrievals.turnId, turnId),
        isNotNull(knowledgeRetrievals.turnId)
      )
    )
  const cited = new Set(citedChunkIds)
  await Promise.all(
    rows.map((row) =>
      db
        .update(knowledgeRetrievals)
        .set({ cited: row.chunkIds.filter((id) => cited.has(id)).length })
        .where(eq(knowledgeRetrievals.id, row.id))
    )
  )
}

export async function ensureGroupCollection(
  chatId: string,
  userId: string,
  name: string
) {
  await db
    .insert(knowledgeCollections)
    .values({ userId, name, groupChatId: chatId })
    .onConflictDoNothing({ target: knowledgeCollections.groupChatId })
  const [collection] = await db
    .select()
    .from(knowledgeCollections)
    .where(eq(knowledgeCollections.groupChatId, chatId))
  return collection
}

// An issue between two passages that are both in use. One whose passages
// were replaced or archived stays as it was, and shows again if they return.
export const liveIssue = sql`exists (select 1 from ${knowledgeChunks} a, ${knowledgeChunks} b where a.id = ${knowledgeIssues.chunkId} and b.id = ${knowledgeIssues.otherChunkId} and a.current and b.current)`

export async function deleteKnowledgeFiles(
  scope: { collectionIds: string[] } | { documentId: string }
) {
  const where =
    "documentId" in scope
      ? eq(knowledgeDocuments.id, scope.documentId)
      : scope.collectionIds.length > 0
        ? inArray(knowledgeDocuments.collectionId, scope.collectionIds)
        : undefined
  if (!where) return
  const files = await db
    .select({ pathname: knowledgeVersions.blobPathname })
    .from(knowledgeVersions)
    .innerJoin(
      knowledgeDocuments,
      eq(knowledgeDocuments.id, knowledgeVersions.documentId)
    )
    .where(and(where, isNotNull(knowledgeVersions.blobPathname)))
  const pathnames = files.flatMap((file) =>
    file.pathname ? [file.pathname] : []
  )
  if (pathnames.length > 0) {
    await del(pathnames).catch((error) =>
      console.error("Couldn't delete knowledge files", error)
    )
  }
}
