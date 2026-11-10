"use client"

import type { UIMessage } from "ai"

import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextTrigger,
} from "@/components/ai-elements/context"
import { getModel } from "@/lib/models"
import type { BotMessageMetadata } from "@/trigger/chat"

const format = new Intl.NumberFormat("en-US")

function Row({ label, tokens }: { label: string; tokens: number | undefined }) {
  if (!tokens) return null
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{format.format(tokens)}</span>
    </div>
  )
}

// How much of the model's context the chat fills, from the latest answer's
// metadata, against the context window of the model that wrote it; hover
// for that answer's tokens and the chat's total. Shows once there's an
// answer to count.
export function ChatUsage({ messages }: { messages: UIMessage[] }) {
  const answers = messages
    .filter((message) => message.role === "assistant")
    .map((message) => message.metadata as BotMessageMetadata | undefined)
  const latest = answers.findLast((metadata) => metadata?.contextTokens)
  if (!latest?.contextTokens) return null

  const usage = latest.usage
  const chatTotal = answers.reduce(
    (sum, metadata) => sum + (metadata?.usage?.totalTokens ?? 0),
    0
  )

  return (
    <Context
      maxTokens={getModel(latest.model).contextWindow}
      usedTokens={latest.contextTokens}
      usage={usage}
    >
      <ContextTrigger size="sm" className="gap-1.5 px-2" />
      <ContextContent side="top" align="start">
        <ContextContentHeader />
        <ContextContentBody className="flex flex-col gap-1.5">
          <p className="text-xs font-book">Last answer</p>
          <Row label="Input" tokens={usage?.inputTokens} />
          <Row
            label="Cached input"
            tokens={usage?.inputTokenDetails?.cacheReadTokens}
          />
          <Row label="Output" tokens={usage?.outputTokens} />
          <Row
            label="Reasoning"
            tokens={usage?.outputTokenDetails?.reasoningTokens}
          />
        </ContextContentBody>
        <ContextContentFooter>
          <span className="text-muted-foreground">This chat</span>
          <span className="font-mono">{format.format(chatTotal)} tokens</span>
        </ContextContentFooter>
      </ContextContent>
    </Context>
  )
}
