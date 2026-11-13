import { tool, type ToolSet } from "ai"
import { z } from "zod"

import {
  forgetNote,
  logRetrieval,
  noteHistory,
  rememberNote,
  searchMemories,
} from "@/chats/memory-data"
import { MEMORY_CATEGORIES } from "@/db/schema"

export type TurnRef = { id?: string }

// A bot's memory tools. `turn` is filled in once the turn is recorded, so
// lookups are scored against its answer. Bots at work on an assignment only
// read.
export function createMemoryTools({
  botId,
  chatId,
  turn,
  readOnly = false,
}: {
  botId: string
  chatId: string
  turn: TurnRef
  readOnly?: boolean
}): ToolSet {
  const recall = tool({
    description:
      "Search your memory: notes you saved in any of your chats, best matches first. Use it before asking the user something they may have told you already.",
    inputSchema: z.object({
      query: z.string().trim().min(1).max(300),
      category: z.enum(MEMORY_CATEGORIES).optional(),
    }),
    execute: async ({ query, category }) => {
      const notes = await searchMemories(botId, query, { category, limit: 6 })
      await logRetrieval({
        botId,
        chatId,
        turnId: turn.id,
        source: "recall",
        query,
        memoryIds: notes.map((note) => note.id),
      })
      return notes.map(({ key, category, content, tags, version }) => ({
        key,
        category,
        content,
        tags,
        version,
      }))
    },
  })
  if (readOnly) return { recall }

  return {
    recall,
    remember: tool({
      description:
        "Save a note to your memory, or update one: saving to a key that exists makes a new version and keeps the old one.",
      inputSchema: z.object({
        key: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .describe("A short, stable name, such as user-timezone"),
        category: z.enum(MEMORY_CATEGORIES),
        content: z.string().trim().min(1).max(2000),
        tags: z.array(z.string().trim().min(1).max(30)).max(8).optional(),
      }),
      execute: async ({ key, category, content, tags }) => {
        const note = await rememberNote(
          botId,
          { key, category, content, tags: tags ?? [] },
          chatId
        )
        return { saved: note.key, version: note.version }
      },
    }),
    forget: tool({
      description:
        "Remove a note from your memory. Its earlier versions stay in its history.",
      inputSchema: z.object({ key: z.string().trim().min(1).max(80) }),
      execute: async ({ key }) => {
        const note = await forgetNote(botId, key, chatId)
        if (!note) throw new Error(`There's no note "${key}" in your memory.`)
        return { forgot: note.key, version: note.version }
      },
    }),
    memory_history: tool({
      description: "Every version of one of your notes, newest first.",
      inputSchema: z.object({ key: z.string().trim().min(1).max(80) }),
      execute: async ({ key }) => {
        const versions = await noteHistory(botId, key)
        if (versions.length === 0) {
          throw new Error(`There's no note "${key}" in your memory.`)
        }
        return versions.map(({ version, content, deleted, createdAt }) => ({
          version,
          content,
          deleted,
          savedAt: createdAt.toISOString(),
        }))
      },
    }),
  }
}
