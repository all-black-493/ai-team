import { createHash } from "node:crypto"

import { logger, schemaTask } from "@trigger.dev/sdk"
import { get, put } from "@vercel/blob"
import { generateText, Output } from "ai"
import { and, eq, inArray, ne, sql } from "drizzle-orm"
import { z } from "zod"

import { recordUsage } from "@/chats/budget-data"
import { recordEmbeddingUsage } from "@/chats/knowledge-data"
import { db } from "@/db"
import {
  knowledgeChunks,
  knowledgeCollections,
  knowledgeDocuments,
  knowledgeIssues,
  knowledgeVersions,
} from "@/db/schema"
import { embedPassages } from "@/lib/embeddings"
import { parseRepository } from "@/lib/knowledge"
import { chunkFile, type Chunk } from "@/trigger/knowledge-text"
import { languageModel, modelProviderOptions } from "@/trigger/models"

const CHECK_MODEL = "claude-haiku-5-5"
const EMBED_BATCH = 96
const INSERT_BATCH = 200
const CHECKED_PASSAGES = 30
const CLOSE_DISTANCE = 0.3
const DUPLICATE_DISTANCE = 0.03
const MAX_PAIRS = 12

async function readBlob(pathname: string) {
  const blob = await get(pathname, { access: "private" })
  if (!blob || blob.statusCode !== 200 || !blob.stream) {
    throw new Error("The file is missing from storage.")
  }
  return new Uint8Array(await new Response(blob.stream).arrayBuffer())
}

function githubHeaders(accept: string) {
  const token = process.env.GITHUB_TOKEN
  return {
    Accept: accept,
    "User-Agent": "ai-team-knowledge",
    ...(token && { Authorization: `Bearer ${token}` }),
  }
}

// Downloads a GitHub repository at a branch, tag or commit as a zip and keeps
// it in Blob with the version.
async function fetchRepository(url: string, ref: string | null) {
  const repository = parseRepository(url)
  if (!repository) throw new Error("That isn't a GitHub repository link.")
  const { owner, repo } = repository
  const wanted = ref || repository.ref || "HEAD"
  const commitResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(wanted)}`,
    { headers: githubHeaders("application/vnd.github.sha") }
  )
  if (!commitResponse.ok) {
    throw new Error(
      commitResponse.status === 404
        ? "GitHub couldn't find that repository or branch. Private repositories need GITHUB_TOKEN."
        : `GitHub answered ${commitResponse.status}.`
    )
  }
  const commit = (await commitResponse.text()).trim()
  const archive = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/zipball/${commit}`,
    { headers: githubHeaders("application/vnd.github+json") }
  )
  if (!archive.ok) throw new Error(`GitHub answered ${archive.status}.`)
  const bytes = new Uint8Array(await archive.arrayBuffer())
  return { owner, repo, commit, bytes }
}

async function embedChunks(title: string, chunks: Chunk[]) {
  const embeddings: number[][] = []
  let tokens = 0
  for (let start = 0; start < chunks.length; start += EMBED_BATCH) {
    const batch = chunks.slice(start, start + EMBED_BATCH)
    const result = await embedPassages(
      batch.map((chunk) => `${title} — ${chunk.section}\n\n${chunk.content}`)
    )
    embeddings.push(...result.embeddings)
    tokens += result.tokens
  }
  return { embeddings, tokens }
}

const verdicts = z.object({
  pairs: z.array(
    z.object({
      pair: z.number().int(),
      verdict: z.enum(["conflict", "superseded", "consistent"]),
      newer: z.enum(["A", "B", "unknown"]),
      summary: z.string(),
    })
  ),
})

// Compares the new version's passages with the closest passages in other
// documents of the collection: near copies are duplicates; for the rest a
// small model says whether they disagree or one replaces the other.
async function checkConflicts(versionId: string, userId: string) {
  const [version] = await db
    .select({
      documentId: knowledgeVersions.documentId,
      collectionId: knowledgeDocuments.collectionId,
      title: knowledgeDocuments.title,
      updatedAt: knowledgeDocuments.updatedAt,
    })
    .from(knowledgeVersions)
    .innerJoin(
      knowledgeDocuments,
      eq(knowledgeDocuments.id, knowledgeVersions.documentId)
    )
    .where(eq(knowledgeVersions.id, versionId))
  const own = await db
    .select({ id: knowledgeChunks.id, ordinal: knowledgeChunks.ordinal })
    .from(knowledgeChunks)
    .where(
      and(
        eq(knowledgeChunks.versionId, versionId),
        eq(knowledgeChunks.current, true)
      )
    )
    .orderBy(knowledgeChunks.ordinal)
  if (own.length === 0) return 0
  const step = Math.max(1, Math.floor(own.length / CHECKED_PASSAGES))
  const sampled = own
    .filter((_, index) => index % step === 0)
    .slice(0, CHECKED_PASSAGES)

  const neighbours = await db.execute<{
    chunk_id: string
    other_id: string
    other_document_id: string
    distance: number
  }>(sql`
    SELECT n.id AS chunk_id, m.id AS other_id, m.document_id AS other_document_id, m.distance
    FROM ${knowledgeChunks} n
    CROSS JOIN LATERAL (
      SELECT o.id, o.document_id, o.embedding <=> n.embedding AS distance
      FROM ${knowledgeChunks} o
      WHERE o.current AND o.collection_id = n.collection_id AND o.document_id <> n.document_id
      ORDER BY o.embedding <=> n.embedding
      LIMIT 2
    ) m
    WHERE n.id IN ${sampled.map((chunk) => chunk.id)}
  `)
  const close = neighbours.rows
    .map((row) => ({ ...row, distance: Number(row.distance) }))
    .filter((row) => row.distance < CLOSE_DISTANCE)
    .toSorted((a, b) => a.distance - b.distance)
  const seen = new Set<string>()
  const pairs = close
    .filter((row) => {
      const key = `${row.chunk_id}:${row.other_id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_PAIRS)
  if (pairs.length === 0) return 0

  const ids = pairs.flatMap((pair) => [pair.chunk_id, pair.other_id])
  const passages = await db
    .select({
      id: knowledgeChunks.id,
      documentId: knowledgeChunks.documentId,
      section: knowledgeChunks.section,
      content: knowledgeChunks.content,
      title: knowledgeDocuments.title,
      updatedAt: knowledgeDocuments.updatedAt,
    })
    .from(knowledgeChunks)
    .innerJoin(
      knowledgeDocuments,
      eq(knowledgeDocuments.id, knowledgeChunks.documentId)
    )
    .where(inArray(knowledgeChunks.id, ids))
  const byId = new Map(passages.map((passage) => [passage.id, passage]))

  type Found = {
    kind: "conflict" | "superseded" | "duplicate"
    chunkId: string
    otherChunkId: string
    otherDocumentId: string
    summary: string
    newerDocumentId: string | null
  }
  const found: Found[] = []
  const judged: typeof pairs = []
  for (const pair of pairs) {
    if (pair.distance < DUPLICATE_DISTANCE) {
      const other = byId.get(pair.other_id)
      found.push({
        kind: "duplicate",
        chunkId: pair.chunk_id,
        otherChunkId: pair.other_id,
        otherDocumentId: pair.other_document_id,
        summary: `Nearly the same text as "${other?.title ?? "another document"}".`,
        newerDocumentId: null,
      })
    } else {
      judged.push(pair)
    }
  }

  if (judged.length > 0) {
    const describe = (id: string) => {
      const passage = byId.get(id)
      if (!passage) return "(missing)"
      return `"${passage.title}" — ${passage.section} (updated ${passage.updatedAt.toISOString().slice(0, 10)})\n${passage.content.slice(0, 1500)}`
    }
    const { output, usage } = await generateText({
      model: languageModel(CHECK_MODEL),
      providerOptions: modelProviderOptions(CHECK_MODEL),
      output: Output.object({ schema: verdicts }),
      system:
        "You check a knowledge base for contradictions. For each numbered pair of passages from different documents, decide:\n- conflict: they state incompatible facts, numbers, rules or steps about the same thing.\n- superseded: they describe the same thing and one is clearly an older version of the other, such as an earlier date, plan or policy.\n- consistent: anything else, including passages that only share a topic or add detail.\nSay which passage is newer (A or B) when the text or dates show it, else unknown. Write a summary of at most 25 words naming the specific disagreement; leave it empty when consistent.",
      prompt: judged
        .map(
          (pair, index) =>
            `Pair ${index + 1}\nA: ${describe(pair.chunk_id)}\n\nB: ${describe(pair.other_id)}`
        )
        .join("\n\n---\n\n"),
    })
    await recordUsage({ userId, kind: "knowledge", model: CHECK_MODEL, usage })
    for (const verdict of output.pairs) {
      const pair = judged[verdict.pair - 1]
      if (!pair || verdict.verdict === "consistent" || !verdict.summary) {
        continue
      }
      found.push({
        kind: verdict.verdict,
        chunkId: pair.chunk_id,
        otherChunkId: pair.other_id,
        otherDocumentId: pair.other_document_id,
        summary: verdict.summary.slice(0, 400),
        newerDocumentId:
          verdict.newer === "A"
            ? version.documentId
            : verdict.newer === "B"
              ? pair.other_document_id
              : null,
      })
    }
  }

  if (found.length > 0) {
    await db
      .insert(knowledgeIssues)
      .values(
        found.map((issue) => ({
          ...issue,
          collectionId: version.collectionId,
          documentId: version.documentId,
        }))
      )
      .onConflictDoNothing()
  }
  return found.length
}

async function ingest(versionId: string) {
  const [row] = await db
    .select({
      version: knowledgeVersions,
      document: knowledgeDocuments,
      userId: knowledgeCollections.userId,
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
    .where(eq(knowledgeVersions.id, versionId))
  if (!row) return { skipped: "gone" }
  const { version, document, userId } = row

  const current = document.currentVersionId
    ? await db.query.knowledgeVersions.findFirst({
        where: eq(knowledgeVersions.id, document.currentVersionId),
      })
    : undefined
  const unchanged = async (sameAs: number) => {
    await db
      .update(knowledgeVersions)
      .set({
        status: "unchanged",
        error: `Same as version ${sameAs}.`,
        processedAt: new Date(),
      })
      .where(eq(knowledgeVersions.id, versionId))
    return { unchanged: sameAs }
  }

  let bytes: Uint8Array
  let fileName = version.fileName
  if (document.source === "repository" && !version.blobPathname) {
    const repository = await fetchRepository(
      document.sourceUrl ?? "",
      document.sourceRef
    )
    if (current?.commit === repository.commit) return unchanged(current.version)
    fileName = `${repository.repo}-${repository.commit.slice(0, 7)}.zip`
    const blob = await put(
      `knowledge/${document.collectionId}/${document.id}/${fileName}`,
      Buffer.from(repository.bytes),
      {
        access: "private",
        contentType: "application/zip",
        addRandomSuffix: true,
      }
    )
    bytes = repository.bytes
    await db
      .update(knowledgeVersions)
      .set({
        blobPathname: blob.pathname,
        fileName,
        contentType: "application/zip",
        size: bytes.byteLength,
        commit: repository.commit,
      })
      .where(eq(knowledgeVersions.id, versionId))
  } else {
    if (!version.blobPathname) throw new Error("The version has no file.")
    bytes = await readBlob(version.blobPathname)
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex")
  if (current && current.id !== versionId && current.sha256 === sha256) {
    return unchanged(current.version)
  }

  const { chunks, sections, characters, truncated } = await chunkFile(
    bytes,
    fileName
  )
  if (chunks.length === 0) throw new Error("There's no text in this file.")
  logger.info("Chunked", { chunks: chunks.length, sections, characters })

  const { embeddings, tokens } = await embedChunks(document.title, chunks)
  await recordEmbeddingUsage(userId, tokens)

  await db
    .delete(knowledgeChunks)
    .where(eq(knowledgeChunks.versionId, versionId))
  for (let start = 0; start < chunks.length; start += INSERT_BATCH) {
    await db.insert(knowledgeChunks).values(
      chunks.slice(start, start + INSERT_BATCH).map((chunk, offset) => ({
        documentId: document.id,
        versionId,
        collectionId: document.collectionId,
        ordinal: start + offset,
        section: chunk.section.slice(0, 300),
        content: chunk.content,
        tokens: Math.ceil(chunk.content.length / 4),
        embedding: embeddings[start + offset],
      }))
    )
  }

  const madeCurrent = await db.transaction(async (tx) => {
    const [fresh] = await tx
      .select({
        archived: knowledgeDocuments.archived,
        currentVersionId: knowledgeDocuments.currentVersionId,
      })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, document.id))
      .for("update")
    const inUse = fresh.currentVersionId
      ? await tx.query.knowledgeVersions.findFirst({
          where: eq(knowledgeVersions.id, fresh.currentVersionId),
          columns: { version: true },
        })
      : undefined
    const newest = !inUse || inUse.version <= version.version
    await tx
      .update(knowledgeVersions)
      .set({
        status: "ready",
        error: null,
        sha256,
        sections,
        chunks: chunks.length,
        characters,
        truncated,
        processedAt: new Date(),
      })
      .where(eq(knowledgeVersions.id, versionId))
    if (!newest) return false
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
      .set({ current: !fresh.archived })
      .where(eq(knowledgeChunks.versionId, versionId))
    await tx
      .update(knowledgeDocuments)
      .set({ currentVersionId: versionId, updatedAt: new Date() })
      .where(eq(knowledgeDocuments.id, document.id))
    return true
  })

  const issues = madeCurrent
    ? await checkConflicts(versionId, userId).catch((error) => {
        logger.error("Couldn't check for conflicts", { error })
        return 0
      })
    : 0
  return { chunks: chunks.length, tokens, issues, current: madeCurrent }
}

export const ingestKnowledge = schemaTask({
  id: "ingest-knowledge",
  schema: z.object({ versionId: z.string().min(1) }),
  queue: { concurrencyLimit: 4 },
  maxDuration: 1800,
  retry: { maxAttempts: 3 },
  run: async ({ versionId }) => ingest(versionId),
  onFailure: async ({ payload, error }) => {
    await db
      .update(knowledgeVersions)
      .set({
        status: "failed",
        error: (error instanceof Error ? error.message : String(error)).slice(
          0,
          500
        ),
        processedAt: new Date(),
      })
      .where(
        and(
          eq(knowledgeVersions.id, payload.versionId),
          ne(knowledgeVersions.status, "ready")
        )
      )
  },
})
