"use server"

import { auth } from "@clerk/nextjs/server"
import { tasks } from "@trigger.dev/sdk"
import { get, head, put } from "@vercel/blob"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  deleteKnowledgeFiles,
  recordEmbeddingUsage,
  searchKnowledge,
} from "@/chats/knowledge-data"
import { db } from "@/db"
import {
  bots,
  collectionBots,
  knowledgeChunks,
  knowledgeCollectionInsertSchema,
  knowledgeCollections,
  knowledgeDetailsSchema,
  knowledgeDocuments,
  knowledgeIssues,
  knowledgeNoteSchema,
  knowledgeVersionInsertSchema,
  knowledgeVersions,
  repositoryImportSchema,
  type KnowledgeCollectionInsert,
  type KnowledgeDetails,
  type KnowledgeNote,
  type RepositoryImport,
} from "@/db/schema"
import {
  isAccepted,
  KNOWLEDGE_KINDS,
  knowledgePrefix,
  kindForFile,
  MAX_KNOWLEDGE_BYTES,
  parseRepository,
  SEARCH_MODES,
  titleFromFileName,
} from "@/lib/knowledge"
import type { ingestKnowledge } from "@/trigger/knowledge"

const idSchema = z.string().min(1)
const uploadSchema = z.object({
  pathname: z.string().min(1).max(500),
  fileName: z.string().trim().min(1).max(255),
})

async function session() {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) throw new Error("Unauthorized")
  return userId
}

async function ownCollection(userId: string, collectionId: string) {
  const collection = await db.query.knowledgeCollections.findFirst({
    where: and(
      eq(knowledgeCollections.id, idSchema.parse(collectionId)),
      eq(knowledgeCollections.userId, userId)
    ),
  })
  if (!collection) throw new Error("Collection not found")
  return collection
}

async function ownDocument(userId: string, documentId: string) {
  const [row] = await db
    .select({ document: knowledgeDocuments, collection: knowledgeCollections })
    .from(knowledgeDocuments)
    .innerJoin(
      knowledgeCollections,
      eq(knowledgeCollections.id, knowledgeDocuments.collectionId)
    )
    .where(
      and(
        eq(knowledgeDocuments.id, idSchema.parse(documentId)),
        eq(knowledgeCollections.userId, userId)
      )
    )
  if (!row) throw new Error("Document not found")
  return row
}

async function ownVersion(userId: string, versionId: string) {
  const [row] = await db
    .select({
      version: knowledgeVersions,
      document: knowledgeDocuments,
      collection: knowledgeCollections,
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
        eq(knowledgeVersions.id, idSchema.parse(versionId)),
        eq(knowledgeCollections.userId, userId)
      )
    )
  if (!row) throw new Error("Version not found")
  return row
}

const refresh = () => revalidatePath("/knowledge", "layout")

async function startIngest(versionId: string) {
  await tasks.trigger<typeof ingestKnowledge>("ingest-knowledge", {
    versionId,
  })
}

async function checkedUpload(collectionId: string, input: unknown) {
  const upload = uploadSchema.parse(input)
  if (
    !upload.pathname.startsWith(knowledgePrefix(collectionId)) ||
    upload.pathname.includes("..")
  ) {
    throw new Error("Not this collection's file")
  }
  if (!isAccepted(upload.fileName)) {
    throw new Error(`Can't read ${upload.fileName}`)
  }
  const blob = await head(upload.pathname)
  if (blob.size > MAX_KNOWLEDGE_BYTES) throw new Error("File too large")
  return { ...upload, size: blob.size, contentType: blob.contentType }
}

async function addVersion(
  userId: string,
  documentId: string,
  values: Partial<typeof knowledgeVersions.$inferInsert> & { fileName: string }
) {
  const version = await db.transaction(async (tx) => {
    const [document] = await tx
      .update(knowledgeDocuments)
      .set({ latestVersion: sql`${knowledgeDocuments.latestVersion} + 1` })
      .where(eq(knowledgeDocuments.id, documentId))
      .returning({ latestVersion: knowledgeDocuments.latestVersion })
    const [version] = await tx
      .insert(knowledgeVersions)
      .values({
        ...values,
        documentId,
        version: document.latestVersion,
        createdBy: userId,
      })
      .returning()
    return version
  })
  await startIngest(version.id)
  return version
}

export async function createCollection(input: KnowledgeCollectionInsert) {
  const userId = await session()
  const values = knowledgeCollectionInsertSchema.parse(input)
  const [collection] = await db
    .insert(knowledgeCollections)
    .values({ ...values, description: values.description || null, userId })
    .returning()
  refresh()
  return collection
}

export async function updateCollection(
  collectionId: string,
  input: KnowledgeCollectionInsert
) {
  const userId = await session()
  const collection = await ownCollection(userId, collectionId)
  const values = knowledgeCollectionInsertSchema.parse(input)
  const [updated] = await db
    .update(knowledgeCollections)
    .set({
      ...values,
      description: values.description || null,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeCollections.id, collection.id))
    .returning()
  refresh()
  return updated
}

export async function deleteCollection(collectionId: string) {
  const userId = await session()
  const collection = await ownCollection(userId, collectionId)
  await deleteKnowledgeFiles({ collectionIds: [collection.id] })
  await db
    .delete(knowledgeCollections)
    .where(eq(knowledgeCollections.id, collection.id))
  refresh()
}

export async function setCollectionBot(
  collectionId: string,
  botId: string,
  enabled: boolean
) {
  const userId = await session()
  const collection = await ownCollection(userId, collectionId)
  if (collection.groupChatId) {
    throw new Error("A group's collection is for its members")
  }
  const bot = await db.query.bots.findFirst({
    where: and(
      eq(bots.id, idSchema.parse(botId)),
      eq(bots.userId, userId),
      isNull(bots.groupChatId)
    ),
    columns: { id: true },
  })
  if (!bot) throw new Error("Bot not found")
  if (z.boolean().parse(enabled)) {
    await db
      .insert(collectionBots)
      .values({ collectionId: collection.id, botId: bot.id })
      .onConflictDoNothing()
  } else {
    await db
      .delete(collectionBots)
      .where(
        and(
          eq(collectionBots.collectionId, collection.id),
          eq(collectionBots.botId, bot.id)
        )
      )
  }
  refresh()
}

export async function addKnowledgeFiles(
  collectionId: string,
  kind: string | null,
  files: unknown[]
) {
  const userId = await session()
  const collection = await ownCollection(userId, collectionId)
  const chosen = z.enum(KNOWLEDGE_KINDS).nullable().parse(kind)
  const uploads = await Promise.all(
    z
      .array(z.unknown())
      .min(1)
      .max(20)
      .parse(files)
      .map((file) => checkedUpload(collection.id, file))
  )
  const documents = []
  for (const upload of uploads) {
    const [document] = await db
      .insert(knowledgeDocuments)
      .values({
        collectionId: collection.id,
        title: titleFromFileName(upload.fileName),
        kind: chosen ?? kindForFile(upload.fileName),
      })
      .returning()
    await addVersion(userId, document.id, {
      blobPathname: upload.pathname,
      fileName: upload.fileName,
      contentType: upload.contentType,
      size: upload.size,
    })
    documents.push(document)
  }
  refresh()
  return documents
}

export async function addVersionFile(
  documentId: string,
  file: unknown,
  note: string
) {
  const userId = await session()
  const { document } = await ownDocument(userId, documentId)
  const upload = await checkedUpload(document.collectionId, file)
  const values = knowledgeVersionInsertSchema.parse({ note })
  const version = await addVersion(userId, document.id, {
    blobPathname: upload.pathname,
    fileName: upload.fileName,
    contentType: upload.contentType,
    size: upload.size,
    note: values.note || null,
  })
  refresh()
  return version
}

const slugOf = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "note"

// A note written in the app, kept in Blob like an uploaded file. With a
// document ID it becomes that note's next version.
export async function writeKnowledgeNote(
  collectionId: string,
  input: KnowledgeNote,
  documentId?: string
) {
  const userId = await session()
  const collection = await ownCollection(userId, collectionId)
  const values = knowledgeNoteSchema.parse(input)
  let document = documentId
    ? (await ownDocument(userId, documentId)).document
    : undefined
  if (document && document.collectionId !== collection.id) {
    throw new Error("Not this collection's note")
  }
  if (document) {
    ;[document] = await db
      .update(knowledgeDocuments)
      .set({ title: values.title, kind: values.kind })
      .where(eq(knowledgeDocuments.id, document.id))
      .returning()
  } else {
    ;[document] = await db
      .insert(knowledgeDocuments)
      .values({
        collectionId: collection.id,
        title: values.title,
        kind: values.kind ?? "meeting-notes",
        source: "note",
      })
      .returning()
  }
  const fileName = `${slugOf(values.title)}.md`
  const blob = await put(
    `${knowledgePrefix(collection.id)}${document.id}/${fileName}`,
    values.content,
    {
      access: "private",
      contentType: "text/markdown; charset=utf-8",
      addRandomSuffix: true,
    }
  )
  await addVersion(userId, document.id, {
    blobPathname: blob.pathname,
    fileName,
    contentType: "text/markdown",
    size: Buffer.byteLength(values.content),
  })
  refresh()
  return document
}

export async function getNoteText(documentId: string) {
  const userId = await session()
  const { document } = await ownDocument(userId, documentId)
  if (document.source !== "note" || !document.currentVersionId) return ""
  const version = await db.query.knowledgeVersions.findFirst({
    where: eq(knowledgeVersions.id, document.currentVersionId),
  })
  if (!version?.blobPathname) return ""
  const blob = await get(version.blobPathname, { access: "private" })
  if (!blob || blob.statusCode !== 200 || !blob.stream) return ""
  return new Response(blob.stream).text()
}

export async function importRepository(
  collectionId: string,
  input: RepositoryImport
) {
  const userId = await session()
  const collection = await ownCollection(userId, collectionId)
  const values = repositoryImportSchema.parse(input)
  const repository = parseRepository(values.sourceUrl ?? "")
  if (!repository) throw new Error("Not a GitHub repository link")
  const ref = values.sourceRef || repository.ref || null
  const [document] = await db
    .insert(knowledgeDocuments)
    .values({
      collectionId: collection.id,
      title: `${repository.owner}/${repository.repo}${ref ? ` @ ${ref}` : ""}`,
      kind: values.kind ?? "code",
      source: "repository",
      sourceUrl: `https://github.com/${repository.owner}/${repository.repo}`,
      sourceRef: ref,
    })
    .returning()
  await addVersion(userId, document.id, { fileName: `${repository.repo}.zip` })
  refresh()
  return document
}

export async function syncRepository(documentId: string) {
  const userId = await session()
  const { document } = await ownDocument(userId, documentId)
  if (document.source !== "repository") {
    throw new Error("Only repositories sync")
  }
  const repository = parseRepository(document.sourceUrl ?? "")
  await addVersion(userId, document.id, {
    fileName: `${repository?.repo ?? "repository"}.zip`,
  })
  refresh()
}

export async function retryVersion(versionId: string) {
  const userId = await session()
  const { version } = await ownVersion(userId, versionId)
  if (version.status !== "failed") return
  await db
    .update(knowledgeVersions)
    .set({ status: "processing", error: null })
    .where(eq(knowledgeVersions.id, version.id))
  await startIngest(version.id)
  refresh()
}

// Puts an earlier version back in use. Its passages are kept, so nothing is
// embedded again.
export async function restoreVersion(versionId: string) {
  const userId = await session()
  const { version, document } = await ownVersion(userId, versionId)
  if (version.status !== "ready") {
    throw new Error("Only a processed version can be restored")
  }
  await db.transaction(async (tx) => {
    await tx
      .update(knowledgeChunks)
      .set({ current: false })
      .where(
        and(
          eq(knowledgeChunks.documentId, document.id),
          eq(knowledgeChunks.current, true)
        )
      )
    await tx
      .update(knowledgeChunks)
      .set({ current: !document.archived })
      .where(eq(knowledgeChunks.versionId, version.id))
    await tx
      .update(knowledgeDocuments)
      .set({ currentVersionId: version.id, updatedAt: new Date() })
      .where(eq(knowledgeDocuments.id, document.id))
  })
  refresh()
}

export async function updateDocumentDetails(
  documentId: string,
  input: KnowledgeDetails
) {
  const userId = await session()
  const { document } = await ownDocument(userId, documentId)
  const values = knowledgeDetailsSchema.parse(input)
  await db
    .update(knowledgeDocuments)
    .set(values)
    .where(eq(knowledgeDocuments.id, document.id))
  refresh()
}

export async function setDocumentArchived(
  documentId: string,
  archived: boolean
) {
  const userId = await session()
  const { document } = await ownDocument(userId, documentId)
  const value = z.boolean().parse(archived)
  await db.transaction(async (tx) => {
    await tx
      .update(knowledgeDocuments)
      .set({ archived: value })
      .where(eq(knowledgeDocuments.id, document.id))
    if (document.currentVersionId) {
      await tx
        .update(knowledgeChunks)
        .set({ current: !value })
        .where(eq(knowledgeChunks.versionId, document.currentVersionId))
    }
  })
  refresh()
}

export async function deleteDocument(documentId: string) {
  const userId = await session()
  const { document } = await ownDocument(userId, documentId)
  await deleteKnowledgeFiles({ documentId: document.id })
  await db
    .delete(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, document.id))
  refresh()
}

export async function setIssueStatus(
  issueId: string,
  status: "open" | "resolved" | "dismissed"
) {
  const userId = await session()
  const value = z.enum(["open", "resolved", "dismissed"]).parse(status)
  const own = db
    .select({ id: knowledgeCollections.id })
    .from(knowledgeCollections)
    .where(eq(knowledgeCollections.userId, userId))
  await db
    .update(knowledgeIssues)
    .set({ status: value, resolvedAt: value === "open" ? null : new Date() })
    .where(
      and(
        eq(knowledgeIssues.id, idSchema.parse(issueId)),
        inArray(knowledgeIssues.collectionId, own)
      )
    )
  refresh()
}

export async function searchCollection(
  collectionId: string,
  query: string,
  mode: string
) {
  const userId = await session()
  const collection = await ownCollection(userId, collectionId)
  const { passages, tokens } = await searchKnowledge({
    collectionIds: [collection.id],
    query: z.string().trim().min(1).max(500).parse(query),
    mode: z.enum(SEARCH_MODES).parse(mode),
    limit: 10,
  })
  await recordEmbeddingUsage(userId, tokens)
  return passages
}
