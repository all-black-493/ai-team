// The models a bot can run on, all served by the Neon AI Gateway. Each one
// calls tools and reads images, which computer use needs: the bot looks at
// its screen through screenshots in tool results. Context windows are from
// models.dev. Shared by the composer's model picker, the token meter and the
// chat agent, so it holds data only.
export const MODELS = [
  {
    id: "claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    provider: "anthropic",
    contextWindow: 1_000_000,
  },
  {
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    provider: "anthropic",
    contextWindow: 1_000_000,
  },
  {
    id: "claude-haiku-5-5",
    name: "Claude Haiku 5.5",
    provider: "anthropic",
    contextWindow: 1_000_000,
  },
  {
    id: "gpt-6-1-sol",
    name: "GPT-6.1 Sol",
    provider: "openai",
    contextWindow: 1_050_000,
  },
  {
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    provider: "openai",
    contextWindow: 1_050_000,
  },
  {
    id: "gemini-4-argon",
    name: "Gemini 4 Argon",
    provider: "google",
    contextWindow: 1_048_576,
  },
  {
    id: "gemini-3-8-flash",
    name: "Gemini 3.8 Flash",
    provider: "google",
    contextWindow: 1_048_576,
  },
] as const

export type Model = (typeof MODELS)[number]
export type ModelId = Model["id"]
export type ModelProvider = Model["provider"]

// What a new bot runs on, and what a bot with an unknown model falls back to.
export const DEFAULT_MODEL: ModelId = "claude-sonnet-5-5"

export const PROVIDER_NAMES: Record<ModelProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
}

export function isModelId(id: unknown): id is ModelId {
  return MODELS.some((model) => model.id === id)
}

export function getModel(id: string | null | undefined): Model {
  return (
    MODELS.find((model) => model.id === id) ??
    MODELS.find((model) => model.id === DEFAULT_MODEL)!
  )
}
