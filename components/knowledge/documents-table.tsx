import Link from "next/link"
import { formatDistanceToNow } from "date-fns"
import { FileTextIcon } from "lucide-react"

import {
  IssuesBadge,
  KindBadge,
  StaleBadge,
  StatusBadge,
} from "@/components/knowledge/knowledge-badges"
import { Badge } from "@/components/ui/badge"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { CollectionDetail } from "@/queries/knowledge"

export function DocumentsTable({
  collectionId,
  documents,
}: {
  collectionId: string
  documents: CollectionDetail["documents"]
}) {
  if (documents.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileTextIcon />
          </EmptyMedia>
          <EmptyTitle>No documents yet</EmptyTitle>
          <EmptyDescription>
            Upload files, write a note or import a repository.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-full">Title</TableHead>
          <TableHead className="hidden sm:table-cell">Kind</TableHead>
          <TableHead className="hidden md:table-cell">Version</TableHead>
          <TableHead className="text-right">Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.map((document) => (
          <TableRow
            key={document.id}
            className={document.archived ? "opacity-60" : undefined}
          >
            <TableCell className="whitespace-normal">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/knowledge/${collectionId}/${document.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {document.title}
                </Link>
                {document.archived && <Badge variant="outline">Archived</Badge>}
                {document.latestStatus !== "ready" && (
                  <StatusBadge
                    status={document.latestStatus}
                    error={document.latestError}
                  />
                )}
                {document.stale && <StaleBadge />}
                <IssuesBadge count={document.issues} />
              </div>
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              <KindBadge kind={document.kind} />
            </TableCell>
            <TableCell className="hidden tabular-nums md:table-cell">
              {document.version ? `v${document.version}` : "—"}
            </TableCell>
            <TableCell className="text-right text-muted-foreground">
              {formatDistanceToNow(document.updatedAt, { addSuffix: true })}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
