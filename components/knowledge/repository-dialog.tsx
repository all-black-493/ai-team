"use client"

import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { FolderGit2Icon } from "lucide-react"
import { Controller, useForm } from "react-hook-form"

import { importRepository } from "@/actions/knowledge"
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
import { repositoryImportSchema, type RepositoryImport } from "@/db/schema"

export function RepositoryDialog({ collectionId }: { collectionId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <FolderGit2Icon data-icon="inline-start" />
        Repository
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import a repository</DialogTitle>
        </DialogHeader>
        <RepositoryForm
          collectionId={collectionId}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function RepositoryForm({
  collectionId,
  onSaved,
}: {
  collectionId: string
  onSaved: () => void
}) {
  const form = useForm({
    resolver: zodResolver(repositoryImportSchema),
    defaultValues: { sourceUrl: "", sourceRef: "", kind: "code" as const },
  })

  async function onSubmit(values: RepositoryImport) {
    try {
      await importRepository(collectionId, values)
      toast.add({ title: "Importing the repository", type: "success" })
      onSaved()
    } catch {
      toast.add({
        title: "Couldn't import the repository",
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
          name="sourceUrl"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="repository-url">GitHub link</FieldLabel>
              <Input
                {...field}
                value={field.value ?? ""}
                id="repository-url"
                placeholder="https://github.com/owner/repo"
                autoComplete="off"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            name="sourceRef"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="repository-ref">Branch</FieldLabel>
                <Input
                  {...field}
                  value={field.value ?? ""}
                  id="repository-ref"
                  placeholder="Default branch"
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
                <FieldLabel htmlFor="repository-kind">Kind</FieldLabel>
                <KindSelect
                  id="repository-kind"
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
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          Import
        </Button>
      </DialogFooter>
    </form>
  )
}
