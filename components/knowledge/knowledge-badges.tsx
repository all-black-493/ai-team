import { AlertTriangleIcon, ClockAlertIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import type { KnowledgeVersion } from "@/db/schema"
import { KNOWLEDGE_KIND_LABELS, type KnowledgeKind } from "@/lib/knowledge"

export function KindBadge({ kind }: { kind: KnowledgeKind }) {
  return <Badge variant="secondary">{KNOWLEDGE_KIND_LABELS[kind]}</Badge>
}

export function StaleBadge() {
  return (
    <Badge variant="outline">
      <ClockAlertIcon data-icon="inline-start" />
      Due for review
    </Badge>
  )
}

export function IssuesBadge({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <Badge variant="outline">
      <AlertTriangleIcon data-icon="inline-start" />
      {count} {count === 1 ? "issue" : "issues"}
    </Badge>
  )
}

export function StatusBadge({
  status,
  error,
}: {
  status: KnowledgeVersion["status"] | null
  error?: string | null
}) {
  if (status === "processing") {
    return (
      <Badge variant="outline">
        <Spinner data-icon="inline-start" />
        Processing
      </Badge>
    )
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" title={error ?? undefined}>
        Failed
      </Badge>
    )
  }
  if (status === "unchanged") {
    return (
      <Badge variant="outline" title={error ?? undefined}>
        No changes
      </Badge>
    )
  }
  return null
}
