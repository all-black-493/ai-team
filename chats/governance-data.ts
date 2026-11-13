import { and, desc, eq } from "drizzle-orm"
import type { UIMessage } from "ai"

import { handoffOf, type Handoff } from "@/chats/handoff"
import { db } from "@/db"
import {
  groupTasks,
  groupVotes,
  messageFlags,
  moderationActions,
  type GroupRole,
  type MessageFlag,
} from "@/db/schema"
import {
  ALL_PERMISSIONS,
  BUILT_IN_ROLES,
  type Permission,
} from "@/lib/governance"

// Not scoped to a user, so callers check who's asking first. No
// "server-only" guard: the Trigger.dev agent imports this too.

// How many past moderation actions and votes a group's state carries.
const RECENT_ACTIONS = 50
const RECENT_VOTES = 20

export type MemberRole = {
  id: string | null
  kind: GroupRole["kind"]
  name: string
  permissions: Permission[]
}

// A role's permissions: Admin always has them all.
function permissionsOf(role: Pick<GroupRole, "kind" | "permissions">) {
  return role.kind === "admin" ? ALL_PERMISSIONS : role.permissions
}

// A chat with everything that governs it: its roles and constitution, its
// bots with their roles and standing, open flags, tasks, votes, the
// moderation record, and whether it's on autopilot. A direct chat comes back
// with its one bot and nothing else.
export async function loadGroupState(chatId: string) {
  const chat = await db.query.chats.findFirst({
    where: (chats, { eq }) => eq(chats.id, chatId),
    columns: {
      id: true,
      kind: true,
      name: true,
      userId: true,
      constitution: true,
      constitutionUpdatedAt: true,
      constitutionUpdatedBy: true,
      sharedMemory: true,
      sharedMemoryUpdatedAt: true,
      sharedMemoryUpdatedBy: true,
      autopilot: true,
      autopilotTurns: true,
    },
    with: {
      roles: { orderBy: (roles, { asc }) => [asc(roles.createdAt)] },
      members: {
        orderBy: (members, { asc }) => [asc(members.joinedAt)],
        columns: { roleId: true },
        with: {
          bot: {
            columns: {
              id: true,
              name: true,
              avatar: true,
              job: true,
              model: true,
              sandboxId: true,
              groupChatId: true,
            },
          },
          role: true,
        },
      },
    },
  })
  if (!chat) {
    throw new Error(`Chat ${chatId} not found`)
  }

  const [flags, tasks, actions, votes] = await Promise.all([
    db.query.messageFlags.findMany({
      where: eq(messageFlags.chatId, chatId),
      orderBy: (flags, { asc }) => [asc(flags.createdAt)],
    }),
    db.query.groupTasks.findMany({
      where: eq(groupTasks.chatId, chatId),
      orderBy: (tasks, { asc }) => [asc(tasks.createdAt)],
    }),
    db.query.moderationActions.findMany({
      where: eq(moderationActions.chatId, chatId),
      orderBy: [desc(moderationActions.createdAt)],
      limit: RECENT_ACTIONS,
    }),
    db.query.groupVotes.findMany({
      where: eq(groupVotes.chatId, chatId),
      orderBy: [desc(groupVotes.createdAt)],
      limit: RECENT_VOTES,
    }),
  ])

  // A bot without a role counts as a Member: the group's own Member role,
  // or the built-in one for a group that has none.
  const memberRole = chat.roles.find((role) => role.kind === "member")
  const fallback: MemberRole = memberRole
    ? { ...memberRole, permissions: permissionsOf(memberRole) }
    : {
        id: null,
        kind: "member",
        name: BUILT_IN_ROLES.member.name,
        permissions: [...BUILT_IN_ROLES.member.permissions],
      }

  const now = Date.now()
  const active = actions.filter(
    (action) => action.expiresAt && action.expiresAt.getTime() > now
  )

  const members = chat.members.map(({ bot, role }) => {
    const held: MemberRole = role
      ? {
          id: role.id,
          kind: role.kind,
          name: role.name,
          permissions: permissionsOf(role),
        }
      : fallback
    const mine = active.filter((action) => action.botId === bot.id)
    const suspension = mine.find((action) => action.action === "suspension")
    const restricted = new Set(
      mine
        .filter((action) => action.action === "temporary_restriction")
        .flatMap((action) => action.details?.permissions ?? [])
    )
    return {
      ...bot,
      role: held,
      // What it may do now: none while suspended, and less while
      // restricted.
      permissions: suspension
        ? []
        : held.permissions.filter((permission) => !restricted.has(permission)),
      suspendedUntil: suspension?.expiresAt ?? null,
      restrictions: mine.filter(
        (action) => action.action === "temporary_restriction"
      ),
    }
  })

  return {
    id: chat.id,
    kind: chat.kind,
    name: chat.name,
    userId: chat.userId,
    constitution: chat.constitution,
    constitutionUpdatedAt: chat.constitutionUpdatedAt,
    constitutionUpdatedBy: chat.constitutionUpdatedBy,
    sharedMemory: chat.sharedMemory,
    sharedMemoryUpdatedAt: chat.sharedMemoryUpdatedAt,
    sharedMemoryUpdatedBy: chat.sharedMemoryUpdatedBy,
    autopilot: chat.autopilot,
    autopilotTurns: chat.autopilotTurns,
    roles: chat.roles.map((role) => ({
      ...role,
      permissions: permissionsOf(role),
    })),
    members,
    flags,
    tasks,
    actions,
    votes,
  }
}

export type GroupState = Awaited<ReturnType<typeof loadGroupState>>
export type GroupMember = GroupState["members"][number]

export function can(member: GroupMember | undefined, permission: Permission) {
  return member?.permissions.includes(permission) ?? false
}

// Who reviews a flag: a bot that may moderate, other than the flagged one,
// the group's own moderator first.
export function reviewerFor(state: GroupState, flag: MessageFlag) {
  const moderators = state.members.filter(
    (member) => member.id !== flag.botId && can(member, "moderate")
  )
  return (
    moderators.find((member) => member.groupChatId === state.id) ??
    moderators[0]
  )
}

// A turn the chat runs on its own, with no new message from the user: a
// handed-off message's answer, a flagged bot's response, a moderator's
// review, or on autopilot, the bot picked to speak next and why.
export type PendingTurn =
  | { kind: "handoff"; botId: string; handoff: Handoff; fromBotId?: string }
  | { kind: "flag-response"; botId: string; flag: MessageFlag }
  | { kind: "flag-review"; botId: string; flag: MessageFlag }
  | { kind: "autopilot"; botId: string; reason: string }
  | { kind: "approval"; botId: string }

const isMember = (state: GroupState, botId: string) =>
  state.members.some((member) => member.id === botId)

// The next such turn that's due whatever else happens, if any: a handoff
// first, then the oldest flag still waiting for its bot's response, then the
// oldest waiting for review. A flag whose bot has left the group, or with
// nobody to review it, waits. Autopilot's turns are picked elsewhere
// (trigger/autopilot.ts), once none of these is due.
export function pendingTurn(
  state: GroupState,
  history: UIMessage[]
): PendingTurn | undefined {
  const last = history.at(-1)
  const handoff = handoffOf(last)
  if (handoff && isMember(state, handoff.botId)) {
    const fromBotId = (last?.metadata as { botId?: string } | undefined)?.botId
    return { kind: "handoff", botId: handoff.botId, handoff, fromBotId }
  }

  const responding = state.flags.find(
    (flag) => flag.status === "awaiting_response" && isMember(state, flag.botId)
  )
  if (responding) {
    return { kind: "flag-response", botId: responding.botId, flag: responding }
  }

  for (const flag of state.flags) {
    if (flag.status !== "awaiting_review") continue
    const reviewer = reviewerFor(state, flag)
    if (reviewer) return { kind: "flag-review", botId: reviewer.id, flag }
  }
  return undefined
}

// Marks a flag answered, with the bot's response, so a moderator reviews it
// next. Only while it's waiting for one.
export async function answerFlag(
  flagId: string,
  response: NonNullable<MessageFlag["response"]>
) {
  const [flag] = await db
    .update(messageFlags)
    .set({ status: "awaiting_review", response })
    .where(
      and(
        eq(messageFlags.id, flagId),
        eq(messageFlags.status, "awaiting_response")
      )
    )
    .returning()
  return flag
}
