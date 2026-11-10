"use client"

import { Suspense, use, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { formatDistanceToNowStrict } from "date-fns"
import { Trash2Icon } from "lucide-react"
import { Controller, useForm, useWatch } from "react-hook-form"

import {
  createGroupChat,
  deleteGroupChat,
  updateGroupChat,
} from "@/actions/group"
import { MessageResponse } from "@/components/ai-elements/message"
import { ChatAvatar } from "@/components/chat-avatar"
import { RoleBadge } from "@/components/role-badge"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import { tally } from "@/chats/collaboration"
import type { GroupOverview } from "@/chats/queries"
import { groupChatInsertSchema, type GroupChatInsert } from "@/db/schema"
import {
  BUILT_IN_ROLES,
  DEFAULT_MODERATOR,
  FLAG_STATUS_LABELS,
  MODERATION_ACTIONS,
  PERMISSIONS,
  TASK_STATUS_LABELS,
  messageRef,
  type BuiltInRole,
} from "@/lib/governance"
import type { UserBot } from "@/queries/bot"

// What the edit dialog reads: the group, and its bots with their roles.
// The group's own bots, such as its moderator, can't be taken out.
export type EditableGroup = {
  id: string
  name: string
  members: {
    id: string
    name: string
    avatar: string
    roleId: string | null
    groupOwned: boolean
  }[]
}

type RoleOption = { value: string; label: string }

// A new group's roles don't exist yet, so its bots pick a built-in one.
const builtInOptions: RoleOption[] = (
  Object.keys(BUILT_IN_ROLES) as BuiltInRole[]
).map((kind) => ({ value: kind, label: BUILT_IN_ROLES[kind].name }))

type GroupChatDialogProps = {
  // The user's bots, streamed from the server; the list waits for them.
  bots: Promise<UserBot[]>
  // Pass a group, and how it governs itself, to edit it; leave them out to
  // create one.
  group?: EditableGroup
  overview?: GroupOverview
  // What opens the dialog, when it isn't controlled with `open`.
  trigger?: React.ReactElement
  // Pass `open` to control the dialog from elsewhere, such as a menu item.
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

// A group chat's settings: its name, its bots and their roles. Editing one
// also shows its rules (constitution and roles) and activity (flags, tasks,
// moderation), which its bots keep, and can delete it. A new group opens once
// it's made.
export function GroupChatDialog({
  bots,
  group,
  overview,
  trigger,
  open,
  onOpenChange,
}: GroupChatDialogProps) {
  const [ownOpen, setOwnOpen] = useState(false)
  const controlled = open !== undefined
  const isOpen = controlled ? open : ownOpen

  function setOpen(next: boolean) {
    if (!controlled) setOwnOpen(next)
    onOpenChange?.(next)
  }

  const form = (
    <Suspense fallback={<GroupChatFormSkeleton />}>
      <GroupChatForm
        bots={bots}
        group={group}
        overview={overview}
        onDone={() => setOpen(false)}
      />
    </Suspense>
  )

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {!controlled && trigger && <DialogTrigger render={trigger} />}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{group ? "Edit group" : "New group chat"}</DialogTitle>
          <DialogDescription>
            {group
              ? "Change its name, who's in it, and their roles."
              : "Name the group and pick which bots are in it."}
          </DialogDescription>
        </DialogHeader>
        {group && overview ? (
          <Tabs defaultValue="members" className="min-w-0">
            <TabsList className="w-full">
              <TabsTrigger value="members">Members</TabsTrigger>
              <TabsTrigger value="rules">Rules</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>
            <TabsContent value="members" className="pt-2">
              {form}
            </TabsContent>
            <TabsContent
              value="rules"
              className="max-h-[60svh] overflow-y-auto pt-2"
            >
              <GroupRules group={group} overview={overview} />
            </TabsContent>
            <TabsContent
              value="activity"
              className="max-h-[60svh] overflow-y-auto pt-2"
            >
              <GroupActivity group={group} overview={overview} />
            </TabsContent>
          </Tabs>
        ) : (
          form
        )}
      </DialogContent>
    </Dialog>
  )
}

function GroupChatForm({
  bots: botsPromise,
  group,
  overview,
  onDone,
}: {
  bots: Promise<UserBot[]>
  group?: EditableGroup
  overview?: GroupOverview
  onDone: () => void
}) {
  const bots = use(botsPromise)
  const router = useRouter()

  // An existing group's own roles, or the built-in ones for a new group.
  const options: RoleOption[] = overview
    ? overview.roles.map((role) => ({ value: role.id, label: role.name }))
    : builtInOptions
  const defaultRole = overview
    ? (overview.roles.find((role) => role.kind === "member")?.id ?? "")
    : "member"
  const groupBots = group?.members.filter((member) => member.groupOwned) ?? []

  // The dialog unmounts its content when closed, so every open starts from
  // the group as it is now, or empty.
  const form = useForm<GroupChatInsert>({
    resolver: zodResolver(groupChatInsertSchema),
    defaultValues: {
      name: group?.name ?? "",
      botIds:
        group?.members
          .filter((member) => !member.groupOwned)
          .map((member) => member.id) ?? [],
      roles: Object.fromEntries(
        group?.members.map((member) => [
          member.id,
          member.roleId ?? defaultRole,
        ]) ?? []
      ),
    },
  })
  const roles = useWatch({ control: form.control, name: "roles" })

  function setRole(botId: string, role: string | undefined) {
    const next = { ...roles }
    if (role) next[botId] = role
    else delete next[botId]
    form.setValue("roles", next, { shouldDirty: true })
  }

  async function onSubmit(values: GroupChatInsert) {
    try {
      if (group) {
        await updateGroupChat(group.id, values)
        toast.add({
          title: "Changes saved",
          description: `${values.name.trim()} is up to date.`,
          type: "success",
        })
        onDone()
      } else {
        const chat = await createGroupChat(values)
        toast.add({
          title: "Group created",
          description: `${values.name.trim()} is ready to chat.`,
          type: "success",
        })
        onDone()
        router.push(`/chats/${chat.id}`)
      }
    } catch {
      toast.add({
        title: group
          ? "Couldn't save the changes"
          : "Couldn't create the group",
        description: "Something went wrong. Please try again.",
        type: "error",
      })
    }
  }

  const isSubmitting = form.formState.isSubmitting
  const tooFewBots = bots.length < 2

  const roleSelect = (botId: string, botName: string) => (
    <Select
      items={options}
      value={roles[botId] ?? defaultRole}
      onValueChange={(next) => setRole(botId, next as string)}
    >
      <SelectTrigger
        size="sm"
        aria-label={`${botName}'s role`}
        className="w-32"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )

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
              <FieldDescription>
                {tooFewBots
                  ? "A group needs at least two bots. Create another one first."
                  : "Each bot's role decides what it can do in the group."}
              </FieldDescription>
              {/* Scrolls when there are many. The padding holds each
                  checkbox's larger hit area and focus ring, which would
                  otherwise overflow it and scroll it with only a few. */}
              <FieldGroup
                data-slot="checkbox-group"
                className="-mx-3 -my-2.5 max-h-72 overflow-y-auto px-3 py-2.5"
              >
                {bots.map((bot) => {
                  const id = `group-bot-${bot.id}`
                  const checked = field.value.includes(bot.id)
                  return (
                    <Field
                      key={bot.id}
                      orientation="horizontal"
                      data-invalid={fieldState.invalid}
                      className="min-h-7"
                    >
                      <Checkbox
                        id={id}
                        name={field.name}
                        checked={checked}
                        aria-invalid={fieldState.invalid}
                        onCheckedChange={(next) => {
                          field.onChange(
                            next
                              ? [...field.value, bot.id]
                              : field.value.filter((botId) => botId !== bot.id)
                          )
                          // A bot that leaves the group leaves its role.
                          if (!next) setRole(bot.id, undefined)
                        }}
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
                      {checked && roleSelect(bot.id, bot.name)}
                    </Field>
                  )
                })}
                {/* The group's own bots are always in it. */}
                {groupBots.map((bot) => (
                  <Field
                    key={bot.id}
                    orientation="horizontal"
                    className="min-h-7"
                  >
                    <Checkbox id={`group-bot-${bot.id}`} checked disabled />
                    <FieldLabel
                      htmlFor={`group-bot-${bot.id}`}
                      className="items-center font-normal"
                    >
                      <ChatAvatar
                        seed={bot.avatar}
                        className="size-5 rounded-sm"
                      />
                      {bot.name}
                      <span className="text-xs text-muted-foreground">
                        The group&apos;s own
                      </span>
                    </FieldLabel>
                    {roleSelect(bot.id, bot.name)}
                  </Field>
                ))}
                {!group && (
                  <p className="text-xs text-muted-foreground">
                    A {DEFAULT_MODERATOR.name.toLowerCase()} bot joins every new
                    group, to keep it to its constitution.
                  </p>
                )}
              </FieldGroup>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </FieldSet>
          )}
        />
      </FieldGroup>
      <DialogFooter>
        {group && <DeleteGroupButton group={group} />}
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={isSubmitting || tooFewBots}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          {group ? "Save changes" : "Create group"}
        </Button>
      </DialogFooter>
    </form>
  )
}

const ago = (date: Date | string) =>
  formatDistanceToNowStrict(new Date(date), { addSuffix: true })

// The rules the group's bots keep: the constitution, and roles with what
// they allow and who holds them.
function GroupRules({
  group,
  overview,
}: {
  group: EditableGroup
  overview: GroupOverview
}) {
  return (
    <div className="flex flex-col gap-6 text-sm">
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Constitution</h3>
        {overview.constitution ? (
          <>
            <MessageResponse className="text-sm">
              {overview.constitution}
            </MessageResponse>
            {overview.constitutionUpdatedAt && (
              <p className="text-xs text-muted-foreground">
                Last amended {ago(overview.constitutionUpdatedAt)}.
              </p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">
            None yet. An admin bot can write one: ask it in the chat.
          </p>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Roles</h3>
        <ItemGroup className="gap-2">
          {overview.roles.map((role) => {
            const holders = overview.members
              .filter((member) => member.role.id === role.id)
              .map(
                (member) =>
                  group.members.find((other) => other.id === member.id)?.name
              )
              .filter(Boolean)
            return (
              <Item key={role.id} variant="outline" size="sm">
                <ItemContent className="gap-1.5">
                  <ItemTitle>
                    <RoleBadge kind={role.kind} name={role.name} />
                    {holders.length > 0 && (
                      <span className="font-normal text-muted-foreground">
                        {holders.join(", ")}
                      </span>
                    )}
                  </ItemTitle>
                  {role.description && (
                    <ItemDescription>{role.description}</ItemDescription>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {role.permissions.map((permission) => (
                      <Badge
                        key={permission}
                        variant="secondary"
                        className="font-normal"
                      >
                        {PERMISSIONS[permission]}
                      </Badge>
                    ))}
                  </div>
                </ItemContent>
              </Item>
            )
          })}
        </ItemGroup>
      </section>
    </div>
  )
}

// What's been happening: flags, tasks, votes and the moderation record.
function GroupActivity({
  group,
  overview,
}: {
  group: EditableGroup
  overview: GroupOverview
}) {
  const nameOf = (id: string | null) =>
    id
      ? (group.members.find((member) => member.id === id)?.name ??
        "A bot that has left")
      : "You"
  return (
    <div className="flex flex-col gap-6 text-sm">
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Flags</h3>
        {overview.flags.length === 0 ? (
          <p className="text-muted-foreground">
            No messages have been flagged.
          </p>
        ) : (
          <ItemGroup className="gap-2">
            {overview.flags.toReversed().map((flag) => (
              <Item key={flag.id} variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle>
                    {nameOf(flag.botId)}&apos;s message #
                    {messageRef(flag.messageId)}
                    <Badge variant="outline">
                      {FLAG_STATUS_LABELS[flag.status]}
                    </Badge>
                  </ItemTitle>
                  <ItemDescription className="line-clamp-none">
                    Flagged by {nameOf(flag.flaggedBy)} {ago(flag.createdAt)}:{" "}
                    {flag.reason}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Tasks</h3>
        {overview.tasks.length === 0 ? (
          <p className="text-muted-foreground">No tasks yet.</p>
        ) : (
          <ItemGroup className="gap-2">
            {overview.tasks.toReversed().map((task) => (
              <Item key={task.id} variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle>
                    {task.title}
                    <Badge variant="outline">
                      {TASK_STATUS_LABELS[task.status]}
                    </Badge>
                  </ItemTitle>
                  <ItemDescription>
                    {task.assigneeId
                      ? `${nameOf(task.assigneeId)}'s`
                      : "Unassigned"}
                    {task.proposedBy && `, from ${nameOf(task.proposedBy)}`}
                    {task.result && `: ${task.result}`}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Votes</h3>
        {overview.votes.length === 0 ? (
          <p className="text-muted-foreground">No votes yet.</p>
        ) : (
          <ItemGroup className="gap-2">
            {overview.votes.map((vote) => (
              <Item key={vote.id} variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle>
                    {vote.question}
                    <Badge variant={vote.outcome ? "secondary" : "outline"}>
                      {vote.outcome ?? "Tied"}
                    </Badge>
                  </ItemTitle>
                  <ItemDescription className="line-clamp-none">
                    Called by {nameOf(vote.calledBy)} {ago(vote.createdAt)}:{" "}
                    {tally(vote.options, vote.ballots)
                      .filter(({ votes }) => votes > 0)
                      .map(({ option, votes }) => `${option} ${votes}`)
                      .join(", ")}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Moderation</h3>
        {overview.actions.length === 0 ? (
          <p className="text-muted-foreground">No actions taken.</p>
        ) : (
          <ItemGroup className="gap-2">
            {overview.actions.map((action) => (
              <Item key={action.id} variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle>
                    <Badge
                      variant={
                        action.action === "removal" ||
                        action.action === "suspension"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {MODERATION_ACTIONS[action.action]}
                    </Badge>
                    {nameOf(action.botId)}
                  </ItemTitle>
                  <ItemDescription className="line-clamp-none">
                    By {nameOf(action.moderatorId)} {ago(action.createdAt)}
                    {action.expiresAt &&
                      `, until ${new Date(action.expiresAt).toLocaleString()}`}
                    : {action.reason}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        )}
      </section>
    </div>
  )
}

// Deleting can't be undone, so it asks first. The group goes with its
// messages, rules and own bots; the user's bots stay. The confirmation stays
// open, with its buttons disabled, until the delete finishes.
function DeleteGroupButton({ group }: { group: EditableGroup }) {
  const router = useRouter()
  const [isDeleting, startTransition] = useTransition()

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteGroupChat(group.id)
      } catch {
        toast.add({
          title: "Couldn't delete the group",
          description: "Something went wrong. Please try again.",
          type: "error",
        })
        return
      }
      toast.add({
        title: "Group deleted",
        description: `${group.name} and its messages are gone.`,
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
          <AlertDialogTitle>Delete {group.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The group goes with its messages, rules and moderator. Your bots
            stay. This can&apos;t be undone.
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
