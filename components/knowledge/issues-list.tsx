"use client"

import { useTransition } from "react"
import Link from "next/link"
import { CheckIcon, XIcon } from "lucide-react"

import { setIssueStatus } from "@/actions/knowledge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { toast } from "@/components/ui/toast"
import { ISSUE_LABELS } from "@/lib/knowledge"
import type { IssueRow } from "@/queries/knowledge"

function Side({
  collectionId,
  documentId,
  title,
  section,
  excerpt,
  newer,
}: {
  collectionId: string
  documentId: string
  title: string
  section: string
  excerpt: string
  newer: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md bg-muted/50 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link
          href={`/knowledge/${collectionId}/${documentId}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {title}
        </Link>
        <span className="text-muted-foreground">{section}</span>
        {newer && <Badge variant="outline">Newer</Badge>}
      </div>
      <p className="line-clamp-4 text-sm text-muted-foreground">{excerpt}</p>
    </div>
  )
}

function IssueCard({
  collectionId,
  issue,
}: {
  collectionId: string
  issue: IssueRow
}) {
  const [pending, startTransition] = useTransition()
  const set = (status: "resolved" | "dismissed") =>
    startTransition(async () => {
      try {
        await setIssueStatus(issue.id, status)
      } catch {
        toast.add({
          title: "Couldn't update the issue",
          description: "Something went wrong. Please try again.",
          type: "error",
        })
      }
    })
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Badge
            variant={issue.kind === "conflict" ? "destructive" : "secondary"}
          >
            {ISSUE_LABELS[issue.kind]}
          </Badge>
        </CardTitle>
        <CardDescription>{issue.summary}</CardDescription>
        <CardAction className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => set("resolved")}
          >
            <CheckIcon data-icon="inline-start" />
            Resolved
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => set("dismissed")}
          >
            <XIcon data-icon="inline-start" />
            Dismiss
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-2 md:grid-cols-2">
        <Side
          collectionId={collectionId}
          documentId={issue.documentId}
          title={issue.title}
          section={issue.section}
          excerpt={issue.excerpt}
          newer={issue.newerDocumentId === issue.documentId}
        />
        <Side
          collectionId={collectionId}
          documentId={issue.otherDocumentId}
          title={issue.otherTitle}
          section={issue.otherSection}
          excerpt={issue.otherExcerpt}
          newer={issue.newerDocumentId === issue.otherDocumentId}
        />
      </CardContent>
    </Card>
  )
}

export function IssuesList({
  collectionId,
  issues,
}: {
  collectionId: string
  issues: IssueRow[]
}) {
  if (issues.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>No conflicts or outdated passages found</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {issues.map((issue) => (
        <IssueCard key={issue.id} collectionId={collectionId} issue={issue} />
      ))}
    </div>
  )
}
