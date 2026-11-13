"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { PlusIcon, ShuffleIcon, Trash2Icon } from "lucide-react"
import { nanoid } from "nanoid"
import { Controller, useForm, useWatch } from "react-hook-form"

import { createBot, deleteBot, updateBot } from "@/actions/bot"
import { ChatAvatar } from "@/components/chat-avatar"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
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
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { toast } from "@/components/ui/toast"
import { botInsertSchema, type Bot, type BotInsert } from "@/db/schema"
import {
  NETWORK_POLICIES,
  SANDBOX_DEFAULTS,
  type NetworkPolicy,
} from "@/lib/sandbox-policy"

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

// What the edit dialog reads and writes.
type EditableBot = Pick<
  Bot,
  | "id"
  | "name"
  | "avatar"
  | "job"
  | "instructions"
  | "networkPolicy"
  | "allowedDomains"
  | "autoStopMinutes"
  | "autoArchiveDays"
>

type BotDialogProps = {
  // Pass a bot to edit it; leave it out to create a new one.
  bot?: EditableBot
  // What opens the dialog. Defaults to a "Create a new bot" button.
  trigger?: React.ReactElement
  // Pass `open` to control the dialog from elsewhere, such as a menu item.
  // No trigger is rendered then.
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function BotDialog({
  bot,
  trigger,
  open,
  onOpenChange,
}: BotDialogProps) {
  const [ownOpen, setOwnOpen] = useState(false)
  const controlled = open !== undefined
  const isOpen = controlled ? open : ownOpen

  function setOpen(next: boolean) {
    if (!controlled) setOwnOpen(next)
    onOpenChange?.(next)
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {!controlled &&
        (trigger ? (
          <DialogTrigger render={trigger} />
        ) : (
          <DialogTrigger render={<Button variant="outline" />}>
            <PlusIcon data-icon="inline-start" />
            Create a new bot
          </DialogTrigger>
        ))}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{bot ? "Edit bot" : "New bot"}</DialogTitle>
          <DialogDescription>
            {bot
              ? "Change its face, its name, or the job it does."
              : "Give it a face, a name, and a job to do."}
          </DialogDescription>
        </DialogHeader>
        <BotForm bot={bot} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

function BotForm({ bot, onSaved }: { bot?: EditableBot; onSaved: () => void }) {
  const [initialAvatar] = useState(() => bot?.avatar ?? nanoid())

  // The dialog unmounts its content when closed, so every open starts
  // from the bot as it is now.
  const form = useForm({
    resolver: zodResolver(botInsertSchema),
    defaultValues: {
      name: bot?.name ?? "",
      avatar: initialAvatar,
      job: bot?.job ?? "",
      instructions: bot?.instructions ?? "",
      networkPolicy: bot?.networkPolicy ?? "default",
      allowedDomains: bot?.allowedDomains ?? "",
      autoStopMinutes: bot?.autoStopMinutes ?? SANDBOX_DEFAULTS.autoStopMinutes,
      autoArchiveDays: bot?.autoArchiveDays ?? SANDBOX_DEFAULTS.autoArchiveDays,
    },
  })
  const networkPolicy = useWatch({
    control: form.control,
    name: "networkPolicy",
  })

  async function onSubmit(values: BotInsert) {
    try {
      if (bot) {
        const { bot: saved, networkError } = await updateBot(bot.id, values)
        toast.add(
          networkError
            ? {
                title: "Saved, but the network setting didn't apply",
                description: networkError,
                type: "warning",
              }
            : {
                title: "Changes saved",
                description: `${saved.name} is up to date.`,
                type: "success",
              }
        )
      } else {
        const created = await createBot(values)
        toast.add({
          title: "Bot created",
          description: `${created.name} is ready to work.`,
          type: "success",
        })
      }
      onSaved()
    } catch {
      toast.add({
        title: bot ? "Couldn't save the changes" : "Couldn't create the bot",
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
      {/* Templates are a starting point; on an existing bot they'd only
          overwrite its job and instructions. */}
      {!bot && (
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
      )}
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
        <FieldSet>
          <FieldLegend>Sandbox</FieldLegend>
          <Controller
            name="networkPolicy"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel>Internet</FieldLabel>
                <ToggleGroup
                  value={[field.value ?? "default"]}
                  onValueChange={(value) =>
                    value[0] && field.onChange(value[0])
                  }
                  variant="outline"
                  size="sm"
                  spacing={0}
                  aria-invalid={fieldState.invalid}
                >
                  {(Object.keys(NETWORK_POLICIES) as NetworkPolicy[]).map(
                    (policy) => (
                      <ToggleGroupItem key={policy} value={policy}>
                        {NETWORK_POLICIES[policy]}
                      </ToggleGroupItem>
                    )
                  )}
                </ToggleGroup>
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />
          {networkPolicy === "domains" && (
            <Controller
              name="allowedDomains"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="bot-domains">Domains</FieldLabel>
                  <Input
                    {...field}
                    value={field.value ?? ""}
                    id="bot-domains"
                    placeholder="github.com, *.npmjs.org"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          )}
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Controller
              name="autoStopMinutes"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="bot-auto-stop">
                    Stop when idle (minutes)
                  </FieldLabel>
                  <Input
                    id="bot-auto-stop"
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={field.value ?? ""}
                    onChange={(event) =>
                      field.onChange(event.target.valueAsNumber)
                    }
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            <Controller
              name="autoArchiveDays"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="bot-auto-archive">
                    Archive when stopped (days)
                  </FieldLabel>
                  <Input
                    id="bot-auto-archive"
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={field.value ?? ""}
                    onChange={(event) =>
                      field.onChange(event.target.valueAsNumber)
                    }
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </FieldGroup>
        </FieldSet>
      </FieldGroup>
      <DialogFooter>
        {bot && <DeleteBotButton bot={bot} />}
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          {bot ? "Save changes" : "Create bot"}
        </Button>
      </DialogFooter>
    </form>
  )
}

// Deleting can't be undone and takes the bot's chat with it, so it asks
// first. The confirmation stays open, with its buttons disabled, until the
// delete finishes.
function DeleteBotButton({ bot }: { bot: EditableBot }) {
  const router = useRouter()
  const [isDeleting, startTransition] = useTransition()

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteBot(bot.id)
      } catch {
        toast.add({
          title: "Couldn't delete the bot",
          description: "Something went wrong. Please try again.",
          type: "error",
        })
        return
      }
      toast.add({
        title: "Bot deleted",
        description: `${bot.name} and its chat are gone.`,
        type: "success",
      })
      // The chat this was opened from no longer exists. Inside the same
      // transition, so the deleted chat's page never shows in between.
      router.replace("/")
    })
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button type="button" variant="destructive" className="sm:mr-auto" />
        }
      >
        <Trash2Icon data-icon="inline-start" />
        Delete
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive">
            <Trash2Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete {bot.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Your chat with {bot.name} goes too. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isDeleting}
            onClick={handleDelete}
          >
            {isDeleting && <Spinner data-icon="inline-start" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
