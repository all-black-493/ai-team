import "server-only"

import { auth } from "@clerk/nextjs/server"
import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

import { ensureGroupCollection, liveIssue } from "@/chats/knowledge-data"
import { db } from "@/db"
import {
  bots,
  chatMembers,
  chats,
  collectionBots,
  knowledgeChunks,
  knowledgeCollections,
  knowledgeDocuments,
  knowledgeIssues,
  knowledgeVersions,
} from "@/db/schema"
import { isStale } from "@/lib/knowledge"

async function currentUser() {
  const { isAuthenticated, userId } = await auth()
  return isAuthenticated ? userId : null
}

export async function getCollections() {
  const userId = await currentUser()
  if (!userId) return []
  const documents = db
    .select({
      collectionId: knowledgeDocuments.collectionId,
      documents: count().as("document_count"),
      updatedAt: sql<Date>`max(${knowledgeDocuments.updatedAt})`.as(
        "last_updated_at"
      ),
    })
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.archived, false))
    .groupBy(knowledgeDocuments.collectionId)
    .as("document_counts")
  const openIssues = db
    .select({
      collectionId: knowledgeIssues.collectionId,
      issues: count().as("open_issue_count"),
    })
    .from(knowledgeIssues)
    .where(and(eq(knowledgeIssues.status, "open"), liveIssue))
    .groupBy(knowledgeIssues.collectionId)
    .as("open_issues")
  const access = db
    .select({
      collectionId: collectionBots.collectionId,
      bots: count().as("bot_count"),
    })
    .from(collectionBots)
    .groupBy(collectionBots.collectionId)
    .as("access")
  return db
    .select({
      id: knowledgeCollections.id,
      name: knowledgeCollections.name,
      description: knowledgeCollections.description,
      groupChatId: knowledgeCollections.groupChatId,
      group: chats.name,
      documents: sql<number>`coalesce(${documents.documents}, 0)`.mapWith(
        Number
      ),
      issues: sql<number>`coalesce(${openIssues.issues}, 0)`.mapWith(Number),
      bots: sql<number>`coalesce(${access.bots}, 0)`.mapWith(Number),
      updatedAt:
        sql<Date>`coalesce(${documents.updatedAt}, ${knowledgeCollections.updatedAt})`.mapWith(
          (value) => new Date(value)
        ),
    })
    .from(knowledgeCollections)
    .leftJoin(chats, eq(chats.id, knowledgeCollections.groupChatId))
    .leftJoin(documents, eq(documents.collectionId, knowledgeCollections.id))
    .leftJoin(openIssues, eq(openIssues.collectionId, knowledgeCollections.id))
    .leftJoin(access, eq(access.collectionId, knowledgeCollections.id))
    .where(eq(knowledgeCollections.userId, userId))
    .orderBy(desc(knowledgeCollections.createdAt))
}

export type CollectionSummary = Awaited<
  ReturnType<typeof getCollections>
>[number]

export async function getCollection(collectionId: string) {
  const userId = await currentUser()
  if (!userId) return null
  const [collection] = await db
    .select({ collection: knowledgeCollections, group: chats.name })
    .from(knowledgeCollections)
    .leftJoin(chats, eq(chats.id, knowledgeCollections.groupChatId))
    .where(
      and(
        eq(knowledgeCollections.id, collectionId),
        eq(knowledgeCollections.userId, userId)
      )
    )
  if (!collection) return null
  const { reviewAfterDays } = collection.collection

  const latest = alias(knowledgeVersions, "latest")
  const current = alias(knowledgeVersions, "current")
  const issueCounts = db
    .select({
      documentId: knowledgeIssues.documentId,
      issues: count().as("issue_count"),
    })
    .from(knowledgeIssues)
    .where(and(eq(knowledgeIssues.status, "open"), liveIssue))
    .groupBy(knowledgeIssues.documentId)
    .as("issue_counts")
  const otherIssueCounts = db
    .select({
      documentId: sql<string>`${knowledgeIssues.otherDocumentId}`.as(
        "other_document_id"
      ),
      issues: count().as("other_issue_count"),
    })
    .from(knowledgeIssues)
    .where(and(eq(knowledgeIssues.status, "open"), liveIssue))
    .groupBy(knowledgeIssues.otherDocumentId)
    .as("other_issue_counts")

  const documents = await db
    .select({
      id: knowledgeDocuments.id,
      title: knowledgeDocuments.title,
      kind: knowledgeDocuments.kind,
      source: knowledgeDocuments.source,
      archived: knowledgeDocuments.archived,
      updatedAt: knowledgeDocuments.updatedAt,
      version: current.version,
      latestStatus: latest.status,
      latestError: latest.error,
      latestVersion: latest.version,
      issues:
        sql<number>`coalesce(${issueCounts.issues}, 0) + coalesce(${otherIssueCounts.issues}, 0)`.mapWith(
          Number
        ),
    })
    .from(knowledgeDocuments)
    .leftJoin(current, eq(current.id, knowledgeDocuments.currentVersionId))
    .leftJoin(
      latest,
      and(
        eq(latest.documentId, knowledgeDocuments.id),
        eq(latest.version, knowledgeDocuments.latestVersion)
      )
    )
    .leftJoin(issueCounts, eq(issueCounts.documentId, knowledgeDocuments.id))
    .leftJoin(
      otherIssueCounts,
      eq(otherIssueCounts.documentId, knowledgeDocuments.id)
    )
    .where(eq(knowledgeDocuments.collectionId, collectionId))
    .orderBy(
      asc(knowledgeDocuments.archived),
      desc(knowledgeDocuments.updatedAt)
    )

  const userBots = await db
    .select({
      id: bots.id,
      name: bots.name,
      avatar: bots.avatar,
      job: bots.job,
    })
    .from(bots)
    .where(and(eq(bots.userId, userId), isNull(bots.groupChatId)))
    .orderBy(asc(bots.name))
  const granted = new Set(
    (
      await db
        .select({ botId: collectionBots.botId })
        .from(collectionBots)
        .where(eq(collectionBots.collectionId, collectionId))
    ).map((row) => row.botId)
  )
  const members = collection.collection.groupChatId
    ? await db
        .select({
          id: bots.id,
          name: bots.name,
          avatar: bots.avatar,
          job: bots.job,
        })
        .from(chatMembers)
        .innerJoin(bots, eq(bots.id, chatMembers.botId))
        .where(eq(chatMembers.chatId, collection.collection.groupChatId))
        .orderBy(asc(bots.name))
    : []

  return {
    ...collection.collection,
    group: collection.group,
    documents: documents.map((document) => ({
      ...document,
      stale: !document.archived && isStale(document.updatedAt, reviewAfterDays),
    })),
    bots: userBots.map((bot) => ({ ...bot, granted: granted.has(bot.id) })),
    members,
    issues: await getIssues(collectionId),
  }
}

export type CollectionDetail = NonNullable<
  Awaited<ReturnType<typeof getCollection>>
>

async function getIssues(collectionId: string, documentId?: string) {
  const document = alias(knowledgeDocuments, "document")
  const other = alias(knowledgeDocuments, "other")
  const chunk = alias(knowledgeChunks, "chunk")
  const otherChunk = alias(knowledgeChunks, "other_chunk")
  return db
    .select({
      id: knowledgeIssues.id,
      kind: knowledgeIssues.kind,
      summary: knowledgeIssues.summary,
      createdAt: knowledgeIssues.createdAt,
      newerDocumentId: knowledgeIssues.newerDocumentId,
      documentId: knowledgeIssues.documentId,
      title: document.title,
      section: chunk.section,
      excerpt: sql<string>`left(${chunk.content}, 400)`,
      otherDocumentId: knowledgeIssues.otherDocumentId,
      otherTitle: other.title,
      otherSection: otherChunk.section,
      otherExcerpt: sql<string>`left(${otherChunk.content}, 400)`,
    })
    .from(knowledgeIssues)
    .innerJoin(document, eq(document.id, knowledgeIssues.documentId))
    .innerJoin(other, eq(other.id, knowledgeIssues.otherDocumentId))
    .innerJoin(chunk, eq(chunk.id, knowledgeIssues.chunkId))
    .innerJoin(otherChunk, eq(otherChunk.id, knowledgeIssues.otherChunkId))
    .where(
      and(
        eq(knowledgeIssues.collectionId, collectionId),
        eq(knowledgeIssues.status, "open"),
        eq(chunk.current, true),
        eq(otherChunk.current, true),
        documentId
          ? sql`(${knowledgeIssues.documentId} = ${documentId} or ${knowledgeIssues.otherDocumentId} = ${documentId})`
          : undefined
      )
    )
    .orderBy(desc(knowledgeIssues.createdAt))
    .limit(100)
}

export type IssueRow = Awaited<ReturnType<typeof getIssues>>[number]

export async function getDocument(collectionId: string, documentId: string) {
  const userId = await currentUser()
  if (!userId) return null
  const [row] = await db
    .select({ document: knowledgeDocuments, collection: knowledgeCollections })
    .from(knowledgeDocuments)
    .innerJoin(
      knowledgeCollections,
      eq(knowledgeCollections.id, knowledgeDocuments.collectionId)
    )
    .where(
      and(
        eq(knowledgeDocuments.id, documentId),
        eq(knowledgeDocuments.collectionId, collectionId),
        eq(knowledgeCollections.userId, userId)
      )
    )
  if (!row) return null
  const versions = await db
    .select()
    .from(knowledgeVersions)
    .where(eq(knowledgeVersions.documentId, documentId))
    .orderBy(desc(knowledgeVersions.version))
  const passages = row.document.currentVersionId
    ? await db
        .select({
          id: knowledgeChunks.id,
          section: knowledgeChunks.section,
          content: knowledgeChunks.content,
        })
        .from(knowledgeChunks)
        .where(eq(knowledgeChunks.versionId, row.document.currentVersionId))
        .orderBy(asc(knowledgeChunks.ordinal))
        .limit(200)
    : []
  return {
    ...row.document,
    collection: row.collection,
    stale:
      !row.document.archived &&
      isStale(row.document.updatedAt, row.collection.reviewAfterDays),
    versions,
    passages,
    issues: await getIssues(collectionId, documentId),
  }
}

export type DocumentDetail = NonNullable<
  Awaited<ReturnType<typeof getDocument>>
>

// A group's shared collection, made the first time it's opened.
export async function getGroupCollection(chatId: string) {
  const userId = await currentUser()
  if (!userId) return null
  const chat = await db.query.chats.findFirst({
    where: and(eq(chats.id, chatId), eq(chats.userId, userId)),
    columns: { id: true, name: true, kind: true },
  })
  if (!chat || chat.kind !== "group") return null
  return ensureGroupCollection(chat.id, userId, chat.name ?? "Group")
}

export async function ownsVersion(versionId: string) {
  const userId = await currentUser()
  if (!userId) return null
  const [row] = await db
    .select({
      pathname: knowledgeVersions.blobPathname,
      fileName: knowledgeVersions.fileName,
      contentType: knowledgeVersions.contentType,
    })
    .from(knowledgeVersions)
    .innerJoin(
      knowledgeDocuments,
      eq(knowledgeDocuments.id, knowledgeVersions.documentId)
    )
    .innerJoin(
      knowledgeCollections,
      eq(knowledgeCollections.id, knowledgeDocuments.collectionId)
    )
    .where(
      and(
        eq(knowledgeVersions.id, versionId),
        eq(knowledgeCollections.userId, userId)
      )
    )
  return row ?? null
}

export async function ownsCollection(collectionId: string) {
  const userId = await currentUser()
  if (!userId) return false
  const rows = await db
    .select({ id: knowledgeCollections.id })
    .from(knowledgeCollections)
    .where(
      and(
        eq(knowledgeCollections.id, collectionId),
        eq(knowledgeCollections.userId, userId)
      )
    )
  return rows.length > 0
}
