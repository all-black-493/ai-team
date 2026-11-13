"use client"

import { useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { NotebookPenIcon } from "lucide-react"
import { Controller, useForm } from "react-hook-form"

import { getNoteText, writeKnowledgeNote } from "@/actions/knowledge"
import { KindSelect } from "@/components/knowledge/kind-select"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { knowledgeNoteSchema, type KnowledgeNote } from "@/db/schema"
import type { KnowledgeKind } from "@/lib/knowledge"

type Note = { id: string; title: string; kind: KnowledgeKind }

export function NoteDialog({
  collectionId,
  note,
}: {
  collectionId: string
  note?: Note
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <NotebookPenIcon data-icon="inline-start" />
        {note ? "Edit" : "Write"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{note ? "Edit note" : "New note"}</DialogTitle>
        </DialogHeader>
        <NoteForm
          collectionId={collectionId}
          note={note}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function NoteForm({
  collectionId,
  note,
  onSaved,
}: {
  collectionId: string
  note?: Note
  onSaved: () => void
}) {
  const [loading, setLoading] = useState(Boolean(note))
  const form = useForm({
    resolver: zodResolver(knowledgeNoteSchema),
    defaultValues: {
      title: note?.title ?? "",
      kind: note?.kind ?? "meeting-notes",
      content: "",
    },
  })

  useEffect(() => {
    if (!note) return
    let active = true
    getNoteText(note.id)
      .then((text) => {
        if (active) form.setValue("content", text)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [note, form])

  async function onSubmit(values: KnowledgeNote) {
    try {
      await writeKnowledgeNote(collectionId, values, note?.id)
      toast.add({
        title: note ? "Saved as a new version" : "Note added",
        type: "success",
      })
      onSaved()
    } catch {
      toast.add({
        title: "Couldn't save the note",
        description: "Something went wrong. Please try again.",
        type: "error",
      })
    }
  }

  const isSubmitting = form.formState.isSubmitting

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-4"
    >
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <Controller
            name="title"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="note-title">Title</FieldLabel>
                <Input
                  {...field}
                  id="note-title"
                  placeholder="Weekly planning, 12 Nov"
                  autoComplete="off"
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />
          <Controller
            name="kind"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="note-kind">Kind</FieldLabel>
                <KindSelect
                  id="note-kind"
                  value={field.value}
                  onChange={field.onChange}
                  invalid={fieldState.invalid}
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />
        </div>
        <Controller
          name="content"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="note-content">Note</FieldLabel>
              <Textarea
                {...field}
                id="note-content"
                rows={14}
                disabled={loading}
                placeholder={loading ? "Loading…" : "Markdown works here."}
                className="max-h-[50svh] font-mono text-sm"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={isSubmitting || loading}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}
