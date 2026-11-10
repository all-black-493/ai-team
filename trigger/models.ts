import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"

import { getModel } from "@/lib/models"

// Every model goes through the Neon AI Gateway (NEON_AI_GATEWAY_BASE_URL and
// NEON_AI_GATEWAY_TOKEN, from `neon env pull`), each family on its native
// API, which is the one that passes images in tool results through: the bot
// sees its own screenshots that way. Not @neon/ai-sdk-provider: it bundles
// older providers that drop those images under AI SDK 7, and sends Gemini
// over the chat completions API, which has no room for them.
const gateway = process.env.NEON_AI_GATEWAY_BASE_URL
const token = process.env.NEON_AI_GATEWAY_TOKEN

const anthropic = createAnthropic({
  baseURL: `${gateway}/anthropic/v1`,
  authToken: token,
})

// The Responses API, the default for OpenAI models.
const openai = createOpenAI({ baseURL: `${gateway}/openai/v1`, apiKey: token })

// The gateway reads its token from Authorization, not Google's key header.
const google = createGoogleGenerativeAI({
  baseURL: `${gateway}/gemini/v1beta`,
  apiKey: token,
  headers: { Authorization: `Bearer ${token}` },
})

// Options a model needs on every call. The gateway doesn't store OpenAI
// responses, so earlier answers can't go back as references to stored items
// (the provider's default, which the gateway rejects): each turn sends the
// whole conversation, its reasoning included as encrypted content.
export function modelProviderOptions(id: string | null | undefined) {
  return getModel(id).provider === "openai"
    ? { openai: { store: false, include: ["reasoning.encrypted_content"] } }
    : undefined
}

// The language model for a bot's model ID, or the default model for an ID
// that's no longer offered.
export function languageModel(id: string | null | undefined) {
  const model = getModel(id)
  switch (model.provider) {
    case "anthropic":
      return anthropic(model.id)
    case "openai":
      return openai(model.id)
    case "google":
      return google(model.id)
  }
}
