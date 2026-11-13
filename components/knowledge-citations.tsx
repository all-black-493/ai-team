"use client"

import { createContext, use } from "react"
import Link from "next/link"
import { getToolName, isToolUIPart, type UIMessage } from "ai"
import { ClockAlertIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import type { KnowledgeData } from "@/chats/knowledge-data"
import {
  CITATION,
  KNOWLEDGE_KIND_LABELS,
  type KnowledgeKind,
} from "@/lib/knowledge"

const KNOWLEDGE_TOOL = "search_knowledge"

export type CitedSource = {
  ref: number
  title: string
  section: string
  version?: number
  kind?: KnowledgeKind
  stale?: boolean
  excerpt?: string
  documentId?: string
  collectionId?: string
  chunkId?: string
}

type ToolResult = {
  ref: number
  title: string
  section: string
  version: number
  kind: KnowledgeKind
  dueForReview: boolean
  content: string
  documentId: string
  collectionId: string
  chunkId: string
}

// Every passage numbered for a bot's answer: those looked up before it
// answered, and those its searches found.
export function sourcesOf(message: UIMessage) {
  const sources = new Map<number, CitedSource>()
  for (const part of message.parts) {
    if (part.type === "data-knowledge") {
      for (const source of (part.data as KnowledgeData).sources ?? []) {
        sources.set(source.ref, source)
      }
    } else if (
      isToolUIPart(part) &&
      getToolName(part) === KNOWLEDGE_TOOL &&
      part.state === "output-available"
    ) {
      const results = (part.output as { results?: ToolResult[] })?.results
      for (const result of results ?? []) {
        sources.set(result.ref, {
          ...result,
          stale: result.dueForReview,
          excerpt: result.content.slice(0, 280),
        })
      }
    }
  }
  return sources
}

const MARKER = /(?<!\w)\[(\d{1,3})\](?!\()/g

// Turns [2] into a citation tag outside code, for numbers that are sources.
export function withCitations(text: string, sources: Map<number, CitedSource>) {
  if (sources.size === 0) return text
  return text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((piece, index) =>
      index % 2 === 1
        ? piece
        : piece.replace(MARKER, (match, n: string) =>
            sources.has(Number(n))
              ? `<citation n="${n}">${n}</citation>`
              : match
          )
    )
    .join("")
}

export function citedRefs(text: string) {
  return new Set([...text.matchAll(CITATION)].map((match) => Number(match[1])))
}

export const CitationContext = createContext<Map<number, CitedSource>>(
  new Map()
)

const linkOf = (source: CitedSource) =>
  source.collectionId && source.documentId
    ? `/knowledge/${source.collectionId}/${source.documentId}${source.chunkId ? `#${source.chunkId}` : ""}`
    : undefined

function Citation({ n }: { n?: string }) {
  const source = use(CitationContext).get(Number(n))
  if (!source) return <>[{n}]</>
  const href = linkOf(source)
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={100}
        closeDelay={0}
        render={
          href ? (
            <Link href={href} aria-label={`Source ${n}: ${source.title}`} />
          ) : (
            <span />
          )
        }
        className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 align-text-top text-[10px] font-medium text-foreground no-underline hover:bg-accent"
      >
        {n}
      </HoverCardTrigger>
      <HoverCardContent className="flex w-80 flex-col gap-1.5">
        <p className="font-medium">{source.title}</p>
        <p className="text-xs text-muted-foreground">
          {[
            source.section,
            source.version ? `v${source.version}` : null,
            source.kind ? KNOWLEDGE_KIND_LABELS[source.kind] : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {source.stale && (
          <Badge variant="outline" className="w-fit">
            <ClockAlertIcon data-icon="inline-start" />
            Due for review
          </Badge>
        )}
        {source.excerpt && (
          <p className="line-clamp-5 text-xs text-muted-foreground">
            {source.excerpt}
          </p>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

export const citationProps = {
  allowedTags: { citation: ["n"] },
  literalTagContent: ["citation"],
  components: { citation: Citation } as Record<string, React.ComponentType>,
}

export function CitedSources({
  sources,
  text,
}: {
  sources: Map<number, CitedSource>
  text: string
}) {
  const cited = [...citedRefs(text)]
    .filter((ref) => sources.has(ref))
    .toSorted((a, b) => a - b)
    .map((ref) => sources.get(ref)!)
  if (cited.length === 0) return null
  return (
    <ol className="flex flex-col gap-1 border-t pt-3 text-xs text-muted-foreground">
      {cited.map((source) => {
        const href = linkOf(source)
        const label = (
          <>
            <span className="tabular-nums">[{source.ref}]</span>{" "}
            <span className="text-foreground">{source.title}</span> ·{" "}
            {source.section}
            {source.version ? ` · v${source.version}` : ""}
          </>
        )
        return (
          <li key={source.ref} className="truncate">
            {href ? (
              <Link href={href} className="underline-offset-4 hover:underline">
                {label}
              </Link>
            ) : (
              label
            )}
          </li>
        )
      })}
    </ol>
  )
}
