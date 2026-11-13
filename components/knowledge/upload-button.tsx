"use client"

import { useRef, useState } from "react"
import { upload } from "@vercel/blob/client"
import { UploadIcon } from "lucide-react"

import { addKnowledgeFiles, addVersionFile } from "@/actions/knowledge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import {
  ACCEPT_ATTRIBUTE,
  isAccepted,
  knowledgePrefix,
  MAX_KNOWLEDGE_BYTES,
} from "@/lib/knowledge"

async function uploadFile(collectionId: string, file: File) {
  const name = file.name.replaceAll(/[^\w.-]+/g, "_") || "file"
  const blob = await upload(`${knowledgePrefix(collectionId)}${name}`, file, {
    access: "private",
    handleUploadUrl: "/api/knowledge-uploads",
    clientPayload: collectionId,
    multipart: file.size > 8 * 1024 * 1024,
  })
  return { pathname: blob.pathname, fileName: file.name }
}

// Uploads files as new documents, or with `documentId` one file as that
// document's next version.
export function UploadButton({
  collectionId,
  documentId,
  label = "Upload",
  variant = "outline",
}: {
  collectionId: string
  documentId?: string
  label?: string
  variant?: "outline" | "default"
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function onFiles(list: FileList | null) {
    const files = [...(list ?? [])]
    if (input.current) input.current.value = ""
    if (files.length === 0) return
    const refused = files.filter(
      (file) => !isAccepted(file.name) || file.size > MAX_KNOWLEDGE_BYTES
    )
    if (refused.length > 0) {
      toast.add({
        title: `Can't add ${refused.map((file) => file.name).join(", ")}`,
        description:
          "Use PDF, Word, Markdown, text, code or zip files up to 50 MB.",
        type: "error",
      })
      return
    }
    setBusy(true)
    try {
      const uploads = await Promise.all(
        files.map((file) => uploadFile(collectionId, file))
      )
      if (documentId) {
        await addVersionFile(documentId, uploads[0], "")
      } else {
        await addKnowledgeFiles(collectionId, null, uploads)
      }
      toast.add({
        title: documentId
          ? "New version uploaded"
          : `${files.length} ${files.length === 1 ? "file" : "files"} uploaded`,
        type: "success",
      })
    } catch {
      toast.add({
        title: "Couldn't upload",
        description: "Something went wrong. Please try again.",
        type: "error",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple={!documentId}
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => onFiles(event.target.files)}
      />
      <Button
        type="button"
        variant={variant}
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <UploadIcon data-icon="inline-start" />
        )}
        {label}
      </Button>
    </>
  )
}
