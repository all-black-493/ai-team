"use client"

import { useTransition } from "react"
import { format } from "date-fns"
import { DownloadIcon, RotateCcwIcon, RefreshCwIcon } from "lucide-react"

import { restoreVersion, retryVersion } from "@/actions/knowledge"
import { StatusBadge } from "@/components/knowledge/knowledge-badges"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import type { KnowledgeVersion } from "@/db/schema"

const size = (bytes: number | null) => {
  if (bytes === null) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function VersionActions({
  version,
  current,
}: {
  version: KnowledgeVersion
  current: boolean
}) {
  const [pending, startTransition] = useTransition()
  const run = (action: () => Promise<void>, failure: string) =>
    startTransition(async () => {
      try {
        await action()
      } catch {
        toast.add({
          title: failure,
          description: "Something went wrong. Please try again.",
          type: "error",
        })
      }
    })
  return (
    <div className="flex justify-end gap-1">
      {version.status === "ready" && !current && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() => restoreVersion(version.id), "Couldn't restore it")
          }
        >
          <RotateCcwIcon data-icon="inline-start" />
          Restore
        </Button>
      )}
      {version.status === "failed" && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(() => retryVersion(version.id), "Couldn't retry")}
        >
          <RefreshCwIcon data-icon="inline-start" />
          Retry
        </Button>
      )}
      {version.blobPathname && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Download version ${version.version}`}
          nativeButton={false}
          render={<a href={`/api/knowledge-files/${version.id}`} download />}
        >
          <DownloadIcon />
        </Button>
      )}
    </div>
  )
}

export function VersionsTable({
  versions,
  currentVersionId,
}: {
  versions: KnowledgeVersion[]
  currentVersionId: string | null
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Version</TableHead>
          <TableHead>File</TableHead>
          <TableHead className="hidden md:table-cell">Passages</TableHead>
          <TableHead className="hidden sm:table-cell">Added</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {versions.map((version) => {
          const current = version.id === currentVersionId
          return (
            <TableRow key={version.id}>
              <TableCell>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums">v{version.version}</span>
                  {current && <Badge>In use</Badge>}
                  <StatusBadge status={version.status} error={version.error} />
                </div>
              </TableCell>
              <TableCell className="max-w-0 whitespace-normal">
                <div className="flex flex-col">
                  <span className="truncate">{version.fileName}</span>
                  <span className="text-xs text-muted-foreground">
                    {[
                      size(version.size),
                      version.commit?.slice(0, 7),
                      version.note,
                      version.status === "failed" ? version.error : null,
                      version.truncated
                        ? "Only the first 4,000 passages"
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              </TableCell>
              <TableCell className="hidden tabular-nums md:table-cell">
                {version.chunks ?? "—"}
              </TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {format(version.createdAt, "d MMM yyyy, HH:mm")}
              </TableCell>
              <TableCell>
                <VersionActions version={version} current={current} />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
