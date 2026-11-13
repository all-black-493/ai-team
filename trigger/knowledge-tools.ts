import { tool, type ToolSet } from "ai"
import { z } from "zod"

import {
  describeIssues,
  issuesFor,
  logKnowledgeRetrieval,
  recordEmbeddingUsage,
  searchKnowledge,
  type SourceRegistry,
} from "@/chats/knowledge-data"
import { SEARCH_MODES } from "@/lib/knowledge"
import type { TurnRef } from "@/trigger/memory-tools"

export const KNOWLEDGE_TOOL = "search_knowledge"

export type Collections = { id: string; name: string }[]

export type KnowledgeContext = {
  userId: string
  botId: string
  chatId: string
  collections: Collections
  sources: SourceRegistry
  turn: TurnRef
}

// Passages matching a message, looked up before the bot answers it. Only
// close matches: a passage that's merely on the same topic stays out.
export async function knowledgeFor(context: KnowledgeContext, query: string) {
  if (context.collections.length === 0 || !query.trim()) {
    return { passages: [], issues: [] }
  }
  const started = Date.now()
  try {
    const { passages, tokens } = await searchKnowledge({
      collectionIds: context.collections.map((collection) => collection.id),
      query,
      limit: 6,
      minSimilarity: 0.45,
    })
    void recordEmbeddingUsage(context.userId, tokens, context.chatId)
    context.sources.add(passages)
    const issues = issuesFor(passages.map((passage) => passage.chunkId))
    void logKnowledgeRetrieval({
      userId: context.userId,
      botId: context.botId,
      chatId: context.chatId,
      turnId: context.turn.id,
      source: "auto",
      query,
      chunkIds: passages.map((passage) => passage.chunkId),
      durationMs: Date.now() - started,
    })
    return { passages, issues: await issues }
  } catch (error) {
    console.error("Couldn't look up knowledge", error)
    return { passages: [], issues: [] }
  }
}

export function createKnowledgeTools(context: KnowledgeContext): ToolSet {
  const { collections } = context
  if (collections.length === 0) return {}
  return {
    [KNOWLEDGE_TOOL]: tool({
      description: `Search the user's knowledge base by meaning and by keyword: ${collections.map((collection) => `"${collection.name}"`).join(", ")}. Returns numbered passages with their document and section, to cite by number. Use "keyword" mode for exact names, identifiers and quoted phrases.`,
      inputSchema: z.object({
        query: z.string().trim().min(1).max(500),
        mode: z.enum(SEARCH_MODES).optional(),
        collection: z
          .string()
          .optional()
          .describe("A collection's name, to search only that one"),
      }),
      execute: async ({ query, mode, collection }, { abortSignal }) => {
        const scoped = collection
          ? collections.filter(
              (one) => one.name.toLowerCase() === collection.toLowerCase()
            )
          : collections
        if (scoped.length === 0) {
          throw new Error(
            `There's no collection "${collection}" you can read. You can read: ${collections.map((one) => one.name).join(", ")}.`
          )
        }
        const started = Date.now()
        const { passages, tokens } = await searchKnowledge({
          collectionIds: scoped.map((one) => one.id),
          query,
          mode,
          limit: 6,
          signal: abortSignal,
        })
        await recordEmbeddingUsage(context.userId, tokens, context.chatId)
        const sources = context.sources.add(passages)
        const issues = await issuesFor(
          passages.map((passage) => passage.chunkId)
        )
        await logKnowledgeRetrieval({
          userId: context.userId,
          botId: context.botId,
          chatId: context.chatId,
          turnId: context.turn.id,
          source: "search",
          query,
          chunkIds: passages.map((passage) => passage.chunkId),
          durationMs: Date.now() - started,
        })
        return {
          results: passages.map((passage, index) => ({
            ref: sources[index].ref,
            title: passage.title,
            section: passage.section,
            kind: passage.kind,
            collection: passage.collection,
            version: passage.version,
            updated: passage.updatedAt.toISOString().slice(0, 10),
            dueForReview: passage.stale,
            content: passage.content,
            documentId: passage.documentId,
            collectionId: passage.collectionId,
            chunkId: passage.chunkId,
          })),
          problems: describeIssues(issues, context.sources) || undefined,
        }
      },
    }),
  }
}
