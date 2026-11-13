// The models a bot can run on, all served by the Neon AI Gateway. Each one
// calls tools and reads images, which computer use needs: the bot looks at
// its screen through screenshots in tool results. Context windows and prices
// (US dollars per million tokens, with the higher rate a long prompt pays
// `over` a size) are the gateway's, from models.dev. Shared by the composer's
// model picker, the token meter, spend limits and the chat agent, so it holds
// data only.
export const MODELS = [
  {
    id: "claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    provider: "anthropic",
    contextWindow: 1_000_000,
    price: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  },
  {
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    provider: "anthropic",
    contextWindow: 1_000_000,
    price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  },
  {
    id: "claude-haiku-5-5",
    name: "Claude Haiku 5.5",
    provider: "anthropic",
    contextWindow: 1_000_000,
    price: {
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      cacheWrite: 0.125,
      over: {
        tokens: 100_000,
        input: 0.5,
        output: 2.5,
        cacheRead: 0.05,
        cacheWrite: 0.625,
      },
    },
  },
  {
    id: "gpt-6-1-sol",
    name: "GPT-6.1 Sol",
    provider: "openai",
    contextWindow: 1_050_000,
    price: {
      input: 2,
      output: 10,
      cacheRead: 0.1,
      cacheWrite: 2.5,
      over: {
        tokens: 272_000,
        input: 4,
        output: 15,
        cacheRead: 0.2,
        cacheWrite: 5,
      },
    },
  },
  {
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    provider: "openai",
    contextWindow: 1_050_000,
    price: {
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      cacheWrite: 0.125,
      over: {
        tokens: 272_000,
        input: 0.2,
        output: 0.75,
        cacheRead: 0.02,
        cacheWrite: 0.25,
      },
    },
  },
  {
    id: "gemini-4-argon",
    name: "Gemini 4 Argon",
    provider: "google",
    contextWindow: 1_048_576,
    price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 4 },
  },
  {
    id: "gemini-3-8-flash",
    name: "Gemini 3.8 Flash",
    provider: "google",
    contextWindow: 1_048_576,
    price: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 1.5 },
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
