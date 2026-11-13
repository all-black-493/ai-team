"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { SearchIcon } from "lucide-react"

import { searchCollection } from "@/actions/knowledge"
import { KindBadge, StaleBadge } from "@/components/knowledge/knowledge-badges"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { Passage } from "@/chats/knowledge-data"
import type { SearchMode } from "@/lib/knowledge"

const MODES: { value: SearchMode; label: string }[] = [
  { value: "hybrid", label: "Hybrid" },
  { value: "semantic", label: "Semantic" },
  { value: "keyword", label: "Keyword" },
]

export function KnowledgeSearch({ collectionId }: { collectionId: string }) {
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<SearchMode>("hybrid")
  const [results, setResults] = useState<Passage[] | null>(null)
  const [pending, startTransition] = useTransition()

  function search(nextMode = mode) {
    const text = query.trim()
    if (!text) return
    startTransition(async () => {
      try {
        setResults(await searchCollection(collectionId, text, nextMode))
      } catch {
        toast.add({
          title: "Couldn't search",
          description: "Something went wrong. Please try again.",
          type: "error",
        })
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-center"
        onSubmit={(event) => {
          event.preventDefault()
          search()
        }}
      >
        <InputGroup className="flex-1">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search this collection"
            aria-label="Search this collection"
          />
          <InputGroupAddon align="inline-end">
            {pending && <Spinner />}
          </InputGroupAddon>
        </InputGroup>
        <ToggleGroup
          value={[mode]}
          onValueChange={(value) => {
            const next = (value[0] as SearchMode | undefined) ?? mode
            setMode(next)
            if (results) search(next)
          }}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Search by"
        >
          {MODES.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button type="submit" size="sm" disabled={pending || !query.trim()}>
          Search
        </Button>
      </form>
      {results &&
        (results.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No matching passages</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="gap-2">
            {results.map((passage) => (
              <Item
                key={passage.chunkId}
                variant="outline"
                render={
                  <Link
                    href={`/knowledge/${collectionId}/${passage.documentId}#${passage.chunkId}`}
                  />
                }
              >
                <ItemContent>
                  <ItemTitle className="flex-wrap">
                    {passage.title}
                    <span className="font-normal text-muted-foreground">
                      {passage.section}
                    </span>
                    <KindBadge kind={passage.kind} />
                    {passage.stale && <StaleBadge />}
                  </ItemTitle>
                  <ItemDescription className="line-clamp-3">
                    {passage.content}
                  </ItemDescription>
                </ItemContent>
                {passage.similarity !== null && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {Math.round(passage.similarity * 100)}%
                  </span>
                )}
              </Item>
            ))}
          </ItemGroup>
        ))}
    </div>
  )
}
