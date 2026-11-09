"use client"

import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { PlusIcon, ShuffleIcon } from "lucide-react"
import { nanoid } from "nanoid"
import { Controller, useForm } from "react-hook-form"

import { createBot } from "@/actions/bot"
import { ChatAvatar } from "@/components/chat-avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { botInsertSchema, type BotInsert } from "@/db/schema"

// One click fills in the job and how to go about it.
const templates = [
  {
    job: "Research assistant",
    instructions:
      "Answer briefly, cite sources, and ask before running anything destructive.",
  },
  {
    job: "Code reviewer",
    instructions:
      "Look for bugs first, then readability. Quote the lines you mean and suggest a fix.",
  },
  {
    job: "Writing editor",
    instructions:
      "Tighten the prose without changing its meaning, and explain each change in one line.",
  },
  {
    job: "Tutor",
    instructions:
      "Teach step by step, ask a question before giving the answer, and check understanding at the end.",
  },
]

export function BotDialog() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <PlusIcon data-icon="inline-start" />
        Create a new bot
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New bot</DialogTitle>
          <DialogDescription>
            Give it a face, a name, and a job to do.
          </DialogDescription>
        </DialogHeader>
        <BotForm onCreated={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

function BotForm({ onCreated }: { onCreated: () => void }) {
  const [initialAvatar] = useState(() => nanoid())

  const form = useForm({
    resolver: zodResolver(botInsertSchema),
    defaultValues: {
      name: "",
      avatar: initialAvatar,
      job: "",
      instructions: "",
    },
  })

  async function onSubmit(values: BotInsert) {
    try {
      const bot = await createBot(values)
      toast.add({
        title: "Bot created",
        description: `${bot.name} is ready to work.`,
        type: "success",
      })
      onCreated()
    } catch {
      toast.add({
        title: "Couldn't create the bot",
        description: "Something went wrong. Please try again.",
        type: "error",
      })
    }
  }

  function applyTemplate(template: (typeof templates)[number]) {
    const options = { shouldDirty: true, shouldValidate: true }
    form.setValue("job", template.job, options)
    form.setValue("instructions", template.instructions, options)
  }

  const isSubmitting = form.formState.isSubmitting

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-4"
    >
      <div
        role="group"
        aria-label="Start from a template"
        className="flex flex-wrap gap-2"
      >
        {templates.map((template) => (
          <Button
            key={template.job}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => applyTemplate(template)}
          >
            {template.job}
          </Button>
        ))}
      </div>
      <FieldGroup>
        <Controller
          name="avatar"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field orientation="horizontal" data-invalid={fieldState.invalid}>
              <ChatAvatar
                seed={field.value ?? initialAvatar}
                animated="hover"
                className="size-10 rounded-lg"
              />
              <FieldContent>
                <FieldTitle>Face</FieldTitle>
                <FieldDescription>
                  Shuffle until you find one you like.
                </FieldDescription>
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </FieldContent>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => field.onChange(nanoid())}
              >
                <ShuffleIcon data-icon="inline-start" />
                Shuffle
              </Button>
            </Field>
          )}
        />
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="bot-name">Name</FieldLabel>
              <Input
                {...field}
                id="bot-name"
                placeholder="Ada"
                autoComplete="off"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          name="job"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="bot-job">Job</FieldLabel>
              <Input
                {...field}
                id="bot-job"
                placeholder="Research assistant"
                autoComplete="off"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          name="instructions"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="bot-instructions">
                How it should work
              </FieldLabel>
              <Textarea
                {...field}
                value={field.value ?? ""}
                id="bot-instructions"
                placeholder="Answer briefly, cite sources, and ask before running anything destructive."
                rows={4}
                className="min-h-24"
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
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          Create bot
        </Button>
      </DialogFooter>
    </form>
  )
}
