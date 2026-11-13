import { createOpenAI } from "@ai-sdk/openai"
import { embed, embedMany } from "ai"

import { EMBEDDING } from "@/lib/knowledge"

const gateway = createOpenAI({
  baseURL: `${process.env.NEON_AI_GATEWAY_BASE_URL}/v1`,
  apiKey: process.env.NEON_AI_GATEWAY_TOKEN,
})

const model = gateway.embedding(EMBEDDING.model)
const providerOptions = { openai: { dimensions: EMBEDDING.dimensions } }

// Qwen3 embeds queries with an instruction and documents without one.
const QUERY_PROMPT =
  "Instruct: Given a question or request, retrieve passages from the user's documents that help answer it\nQuery: "

export const embeddingCost = (tokens: number) =>
  (tokens * EMBEDDING.dollarsPerMillionTokens) / 1_000_000

export async function embedPassages(values: string[]) {
  if (values.length === 0) return { embeddings: [], tokens: 0 }
  const { embeddings, usage } = await embedMany({
    model,
    values,
    providerOptions,
    maxParallelCalls: 2,
  })
  return { embeddings, tokens: usage.tokens }
}

export async function embedQuery(query: string, abortSignal?: AbortSignal) {
  const { embedding, usage } = await embed({
    model,
    value: `${QUERY_PROMPT}${query}`,
    providerOptions,
    abortSignal,
  })
  return { embedding, tokens: usage.tokens }
}
