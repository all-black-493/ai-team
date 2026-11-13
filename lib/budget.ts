import type { LanguageModelUsage } from "ai"

import type { UserSettings } from "../db/schema"
import { MAX_PARALLEL_BOTS } from "./governance"
import { getModel } from "./models"

// Shared by the schema, the agent and the settings form, so data only.

export const DEFAULT_LIMITS = {
  chatSpendLimit: 5,
  userSpendLimit: 100,
  dailySpendLimit: 10,
  warnAtPercent: 80,
  maxAutopilotTurns: 24,
  maxParallelBots: 4,
  maxTaskMinutes: 15,
  maxToolCalls: 50,
  maxShellCommands: 25,
  compactAfterTokens: 60_000,
}

// The highest each limit can be set to. Parallel bots and minutes are also
// bounded by the agent: six bots per call, and a run's hour of compute.
export const LIMIT_CEILINGS = {
  spend: 10_000,
  maxAutopilotTurns: 100,
  maxParallelBots: MAX_PARALLEL_BOTS,
  maxTaskMinutes: 60,
  maxToolCalls: 200,
  maxShellCommands: 200,
  compactMinTokens: 8_000,
  compactMaxTokens: 900_000,
}

export const SPEND_SCOPES = {
  chat: "this chat",
  user: "all your chats",
  day: "today",
} as const

export type SpendScope = keyof typeof SPEND_SCOPES

export const APPROVAL_KINDS = {
  approveFileDeletes: "Deleting files",
  approveCodePushes: "Pushing code",
  approveRoleChanges: "Changing roles",
  approveIntegrations: "Calling MCP tools",
} as const

export type ApprovalKind = keyof typeof APPROVAL_KINDS

export const SHELL_TOOLS = ["run_command", "run_code"]

const DELETES =
  /(^|[\s;&|(`$'"])(rm|rmdir|unlink|shred|srm)(\s|$)|\bfind\b.*\s-delete\b|\bgit\s+(clean|rm)\b|\bmkfs\b|\bdd\b.*\bof=|\bos\.(remove|unlink|rmdir|removedirs)\b|\bshutil\.rmtree\b|\.(unlink|rmdir)\(/
const PUSHES =
  /\bgit\s+push\b|\bgh\s+(pr\s+merge|release\s+create|repo\s+delete)\b|\b(npm|pnpm|yarn)\s+publish\b|\btwine\s+upload\b/

// What a command or script would do that needs the user's approval.
export function riskOf(source: string): ApprovalKind | undefined {
  if (DELETES.test(source)) return "approveFileDeletes"
  if (PUSHES.test(source)) return "approveCodePushes"
  return undefined
}

// A model call's cost in US dollars, at the gateway's rates.
export function costOf(modelId: string, usage: LanguageModelUsage) {
  const { price } = getModel(modelId)
  const input = usage.inputTokens ?? 0
  const rate = "over" in price && input > price.over.tokens ? price.over : price
  const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? 0
  const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens ?? 0
  const fresh =
    usage.inputTokenDetails?.noCacheTokens ??
    Math.max(0, input - cacheRead - cacheWrite)
  return (
    (fresh * rate.input +
      cacheRead * rate.cacheRead +
      cacheWrite * rate.cacheWrite +
      (usage.outputTokens ?? 0) * rate.output) /
    1_000_000
  )
}

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const cents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumSignificantDigits: 2,
})

export function formatCost(amount: number) {
  return amount > 0 && amount < 0.01
    ? cents.format(amount)
    : dollars.format(amount)
}

export type Limits = Omit<UserSettings, "userId" | "updatedAt">

export type Spend = Record<SpendScope, number>

const LIMIT_OF: Record<SpendScope, keyof Limits> = {
  chat: "chatSpendLimit",
  user: "userSpendLimit",
  day: "dailySpendLimit",
}

// Each spend limit with what's been spent against it, the most used first.
export function budgetOf(limits: Limits, spend: Spend) {
  const scopes = (Object.keys(LIMIT_OF) as SpendScope[])
    .map((scope) => {
      const limit = limits[LIMIT_OF[scope]] as number | null
      return {
        scope,
        limit,
        spent: spend[scope],
        used: limit ? spend[scope] / limit : 0,
      }
    })
    .toSorted((a, b) => b.used - a.used)
  const tightest = scopes[0]
  const remaining = Math.min(
    ...scopes.map((item) =>
      item.limit === null ? Infinity : item.limit - item.spent
    )
  )
  return {
    scopes,
    remaining,
    exhausted: remaining <= 0,
    warning:
      tightest.limit !== null && tightest.used * 100 >= limits.warnAtPercent,
  }
}

export type Budget = ReturnType<typeof budgetOf>

const LIMIT_NAMES: Record<SpendScope, string> = {
  chat: "this chat's",
  user: "your total",
  day: "today's",
}

// How a spend limit reads, as in "$8.10 of today's $10.00".
export function describeScope(item: Budget["scopes"][number]) {
  return item.limit === null
    ? `${formatCost(item.spent)} spent ${SPEND_SCOPES[item.scope]}`
    : `${formatCost(item.spent)} of ${LIMIT_NAMES[item.scope]} ${formatCost(item.limit)}`
}
