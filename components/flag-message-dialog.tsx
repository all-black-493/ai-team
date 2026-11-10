"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"

import { flagMessage } from "@/actions/group"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  messageFlagInsertSchema,
  type MessageFlag,
  type MessageFlagInsert,
} from "@/db/schema"

export type FlaggedMessage = {
  id: string
  botId: string
  botName: string
  text: string
}

type FlagMessageDialogProps = {
  chatId: string
  // The bot message being flagged; the dialog is open while there is one.
  message: FlaggedMessage | null
  onOpenChange: (open: boolean) => void
  // Once flagged: the chat then has the bot answer and a moderator review.
  onFlagged: (flag: MessageFlag) => void
}

// Flags a bot's message in a group for breaking the constitution, with the
// rule it breaks and why. Opened from the message's toolbar.
export function FlagMessageDialog({
  chatId,
  message,
  onOpenChange,
  onFlagged,
}: FlagMessageDialogProps) {
  return (
    <Dialog open={message !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Flag {message?.botName}&apos;s message</DialogTitle>
          <DialogDescription>
            {message?.botName} answers the flag first. Then a moderator reviews
            it and decides what to do.
          </DialogDescription>
        </DialogHeader>
        {message && (
          <FlagMessageForm
            chatId={chatId}
            message={message}
            onFlagged={(flag) => {
              onOpenChange(false)
              onFlagged(flag)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function FlagMessageForm({
  chatId,
  message,
  onFlagged,
}: {
  chatId: string
  message: FlaggedMessage
  onFlagged: (flag: MessageFlag) => void
}) {
  // The dialog unmounts its content when closed, so every flag starts empty.
  const form = useForm<MessageFlagInsert>({
    resolver: zodResolver(messageFlagInsertSchema),
    defaultValues: {
      messageId: message.id,
      botId: message.botId,
      rule: "",
      reason: "",
    },
  })

  async function onSubmit(values: MessageFlagInsert) {
    try {
      const flag = await flagMessage(chatId, values)
      toast.add({
        title: "Message flagged",
        description: `${message.botName} answers it next, then a moderator decides.`,
        type: "success",
      })
      onFlagged(flag)
    } catch {
      toast.add({
        title: "Couldn't flag the message",
        description: "It may be flagged already. Please try again.",
        type: "error",
      })
    }
  }

  const isSubmitting = form.formState.isSubmitting
  const quote =
    message.text.length > 280 ? `${message.text.slice(0, 280)}…` : message.text

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-4"
    >
      {quote && (
        <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground">
          {quote}
        </blockquote>
      )}
      <FieldGroup>
        <Controller
          name="rule"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="flag-rule">Rule it breaks</FieldLabel>
              <Input
                {...field}
                value={field.value ?? ""}
                id="flag-rule"
                placeholder="Article 2: stay within your own job"
                autoComplete="off"
                aria-invalid={fieldState.invalid}
              />
              <FieldDescription>
                Optional: from the group&apos;s constitution.
              </FieldDescription>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          name="reason"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="flag-reason">What&apos;s wrong</FieldLabel>
              <Textarea
                {...field}
                id="flag-reason"
                placeholder="It answered a writing question meant for Quill."
                rows={3}
                className="min-h-20"
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
          Flag message
        </Button>
      </DialogFooter>
    </form>
  )
}
