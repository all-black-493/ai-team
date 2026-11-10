"use client"

import { Suspense, use } from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"

import { createGroupChat } from "@/actions/bot"
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
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { groupChatSchema, type GroupChatInput } from "@/chats/group"
import type { UserBot } from "@/queries/bot"

type GroupChatDialogProps = {
  // The user's bots, streamed from the server; the list waits for them.
  bots: Promise<UserBot[]>
  open: boolean
  onOpenChange: (open: boolean) => void
}

// A name and two or more bots make a group chat, which opens once it's made.
export function GroupChatDialog({
  bots,
  open,
  onOpenChange,
}: GroupChatDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New group chat</DialogTitle>
          <DialogDescription>
            Name the group and pick which bots are in it.
          </DialogDescription>
        </DialogHeader>
        <Suspense fallback={<GroupChatFormSkeleton />}>
          <GroupChatForm bots={bots} onCreated={() => onOpenChange(false)} />
        </Suspense>
      </DialogContent>
    </Dialog>
  )
}

function GroupChatForm({
  bots: botsPromise,
  onCreated,
}: {
  bots: Promise<UserBot[]>
  onCreated: () => void
}) {
  const bots = use(botsPromise)
  const router = useRouter()

  // The dialog unmounts its content when closed, so every open starts empty.
  const form = useForm({
    resolver: zodResolver(groupChatSchema),
    defaultValues: { name: "", botIds: [] as string[] },
  })

  async function onSubmit(values: GroupChatInput) {
    try {
      const chatId = await createGroupChat(values)
      toast.add({
        title: "Group created",
        description: `${values.name.trim()} is ready to chat.`,
        type: "success",
      })
      onCreated()
      router.push(`/chats/${chatId}`)
    } catch {
      toast.add({
        title: "Couldn't create the group",
        description: "Something went wrong. Please try again.",
        type: "error",
      })
    }
  }

  const isSubmitting = form.formState.isSubmitting
  const tooFewBots = bots.length < 2

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
              <FieldLabel htmlFor="group-name">Name</FieldLabel>
              <Input
                {...field}
                id="group-name"
                placeholder="Weekend plans"
                autoComplete="off"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          name="botIds"
          control={form.control}
          render={({ field, fieldState }) => (
            <FieldSet data-invalid={fieldState.invalid}>
              <FieldLegend variant="label">Bots</FieldLegend>
              {tooFewBots && (
                <FieldDescription>
                  A group needs at least two bots. Create another one first.
                </FieldDescription>
              )}
              {/* Scrolls when there are many. The padding holds each
                  checkbox's larger hit area and focus ring, which would
                  otherwise overflow it and scroll it with only a few. */}
              <FieldGroup
                data-slot="checkbox-group"
                className="-mx-3 -my-2.5 max-h-64 overflow-y-auto px-3 py-2.5"
              >
                {bots.map((bot) => {
                  const id = `group-bot-${bot.id}`
                  const checked = field.value.includes(bot.id)
                  return (
                    <Field
                      key={bot.id}
                      orientation="horizontal"
                      data-invalid={fieldState.invalid}
                    >
                      <Checkbox
                        id={id}
                        name={field.name}
                        checked={checked}
                        aria-invalid={fieldState.invalid}
                        onCheckedChange={(next) =>
                          field.onChange(
                            next
                              ? [...field.value, bot.id]
                              : field.value.filter((botId) => botId !== bot.id)
                          )
                        }
                      />
                      <FieldLabel
                        htmlFor={id}
                        className="items-center font-normal"
                      >
                        <ChatAvatar
                          seed={bot.avatar}
                          className="size-5 rounded-sm"
                        />
                        {bot.name}
                      </FieldLabel>
                    </Field>
                  )
                })}
              </FieldGroup>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </FieldSet>
          )}
        />
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={isSubmitting || tooFewBots}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          Create group
        </Button>
      </DialogFooter>
    </form>
  )
}

// The form's shape while the bots load.
function GroupChatFormSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <Skeleton className="h-8 w-full" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-5 w-40" />
        ))}
      </div>
    </div>
  )
}
