"use client"

import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { PencilIcon } from "lucide-react"
import { Controller, useForm } from "react-hook-form"

import { updateDocumentDetails } from "@/actions/knowledge"
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
import { toast } from "@/components/ui/toast"
import { knowledgeDetailsSchema, type KnowledgeDetails } from "@/db/schema"

type Details = { id: string } & KnowledgeDetails

export function DetailsDialog({ document }: { document: Details }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="outline" aria-label="Edit details" />}
      >
        <PencilIcon />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
        </DialogHeader>
        <DetailsForm document={document} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

function DetailsForm({
  document,
  onSaved,
}: {
  document: Details
  onSaved: () => void
}) {
  const form = useForm({
    resolver: zodResolver(knowledgeDetailsSchema),
    defaultValues: { title: document.title, kind: document.kind },
  })

  async function onSubmit(values: KnowledgeDetails) {
    try {
      await updateDocumentDetails(document.id, values)
      toast.add({ title: "Details saved", type: "success" })
      onSaved()
    } catch {
      toast.add({
        title: "Couldn't save the details",
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
        <Controller
          name="title"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="document-title">Title</FieldLabel>
              <Input
                {...field}
                id="document-title"
                autoComplete="off"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          name="kind"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="document-kind">Kind</FieldLabel>
              <KindSelect
                id="document-kind"
                value={field.value}
                onChange={field.onChange}
                invalid={fieldState.invalid}
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
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}
