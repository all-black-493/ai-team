"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { PlusIcon } from "lucide-react"
import { Controller, useForm } from "react-hook-form"

import { createCollection, updateCollection } from "@/actions/knowledge"
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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import {
  knowledgeCollectionInsertSchema,
  type KnowledgeCollection,
  type KnowledgeCollectionInsert,
} from "@/db/schema"
import { DEFAULT_REVIEW_DAYS } from "@/lib/knowledge"

type Editable = Pick<
  KnowledgeCollection,
  "id" | "name" | "description" | "reviewAfterDays" | "groupChatId"
>

export function CollectionDialog({
  collection,
  trigger,
}: {
  collection?: Editable
  trigger?: React.ReactElement
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger render={trigger} />
      ) : (
        <DialogTrigger render={<Button />}>
          <PlusIcon data-icon="inline-start" />
          New collection
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {collection ? "Collection settings" : "New collection"}
          </DialogTitle>
        </DialogHeader>
        <CollectionForm
          collection={collection}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function CollectionForm({
  collection,
  onSaved,
}: {
  collection?: Editable
  onSaved: () => void
}) {
  const router = useRouter()
  const form = useForm({
    resolver: zodResolver(knowledgeCollectionInsertSchema),
    defaultValues: {
      name: collection?.name ?? "",
      description: collection?.description ?? "",
      reviewAfterDays: collection?.reviewAfterDays ?? DEFAULT_REVIEW_DAYS,
    },
  })

  async function onSubmit(values: KnowledgeCollectionInsert) {
    try {
      if (collection) {
        await updateCollection(collection.id, values)
        toast.add({ title: "Collection saved", type: "success" })
      } else {
        const created = await createCollection(values)
        toast.add({ title: "Collection created", type: "success" })
        router.push(`/knowledge/${created.id}`)
      }
      onSaved()
    } catch {
      toast.add({
        title: collection
          ? "Couldn't save the collection"
          : "Couldn't create the collection",
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
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="collection-name">Name</FieldLabel>
              <Input
                {...field}
                id="collection-name"
                placeholder="Product specs"
                autoComplete="off"
                disabled={Boolean(collection?.groupChatId)}
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          name="description"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="collection-description">
                Description
              </FieldLabel>
              <Textarea
                {...field}
                value={field.value ?? ""}
                id="collection-description"
                rows={3}
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          name="reviewAfterDays"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="collection-review">
                Review after (days)
              </FieldLabel>
              <Input
                id="collection-review"
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                type="number"
                inputMode="numeric"
                min={1}
                value={field.value ?? ""}
                onChange={(event) => field.onChange(event.target.valueAsNumber)}
                aria-invalid={fieldState.invalid}
              />
              <FieldDescription>
                Documents not updated for this long are marked as due for
                review, and bots treat them as possibly outdated.
              </FieldDescription>
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
          {collection ? "Save" : "Create"}
        </Button>
      </DialogFooter>
    </form>
  )
}
