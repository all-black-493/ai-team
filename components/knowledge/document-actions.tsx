"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"

import {
  deleteDocument,
  setDocumentArchived,
  syncRepository,
} from "@/actions/knowledge"
import { DetailsDialog } from "@/components/knowledge/details-dialog"
import { NoteDialog } from "@/components/knowledge/note-dialog"
import { UploadButton } from "@/components/knowledge/upload-button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import type { KnowledgeDocument } from "@/db/schema"

export function DocumentActions({
  document,
}: {
  document: Pick<
    KnowledgeDocument,
    "id" | "collectionId" | "title" | "kind" | "source" | "archived"
  >
}) {
  const router = useRouter()
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
    <div className="flex flex-wrap gap-2">
      {document.source === "note" && (
        <NoteDialog collectionId={document.collectionId} note={document} />
      )}
      {document.source === "repository" && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => syncRepository(document.id), "Couldn't sync it")
          }
        >
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
          Sync
        </Button>
      )}
      {document.source === "upload" && (
        <UploadButton
          collectionId={document.collectionId}
          documentId={document.id}
          label="New version"
        />
      )}
      {document.source !== "note" && <DetailsDialog document={document} />}
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          run(
            () => setDocumentArchived(document.id, !document.archived),
            "Couldn't change it"
          )
        }
      >
        {document.archived ? (
          <ArchiveRestoreIcon data-icon="inline-start" />
        ) : (
          <ArchiveIcon data-icon="inline-start" />
        )}
        {document.archived ? "Unarchive" : "Archive"}
      </Button>
      <AlertDialog>
        <AlertDialogTrigger
          render={<Button variant="outline" aria-label="Delete document" />}
        >
          <Trash2Icon />
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{document.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Every version and its file go too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                run(async () => {
                  await deleteDocument(document.id)
                  router.push(`/knowledge/${document.collectionId}`)
                }, "Couldn't delete it")
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
