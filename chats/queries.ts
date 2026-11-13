import "server-only"

import { cache } from "react"
import { auth } from "@clerk/nextjs/server"
import { desc, eq } from "drizzle-orm"

import { loadLimits, spendOf } from "@/chats/budget-data"
import { loadGroupState } from "@/chats/governance-data"
import { db } from "@/db"
import { chatEvents, type MessageRating } from "@/db/schema"
import { budgetOf } from "@/lib/budget"

// One of the signed-in user's chats, or null when it doesn't exist, belongs to
// someone else, or nobody is signed in. The user ID comes from the Clerk
// session, never from a caller. `members` are its bots in the order they
// joined, with their roles in a group, and whether the group owns them (its
// moderator); `bot` is a direct chat's one bot, and null for a group.
export const getChat = cache(async (chatId: string) => {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) return null

  const chat = await db.query.chats.findFirst({
    where: (chats, { and, eq }) =>
      and(eq(chats.id, chatId), eq(chats.userId, userId)),
    columns: { id: true, kind: true, name: true },
    with: {
      members: {
        orderBy: (members, { asc }) => [asc(members.joinedAt)],
        columns: {},
        // Everything the edit dialog and the model picker need, too.
        with: {
          bot: {
            columns: {
              id: true,
              name: true,
              avatar: true,
              job: true,
              instructions: true,
              model: true,
              groupChatId: true,
              sandboxId: true,
              networkPolicy: true,
              allowedDomains: true,
              autoStopMinutes: true,
              autoArchiveDays: true,
            },
          },
          // A bot's role in a group; direct chats don't use it.
          role: { columns: { id: true, kind: true, name: true } },
        },
      },
    },
  })
  if (!chat) return null

  const { members: rows, ...rest } = chat
  const members = rows.map(
    ({ bot: { groupChatId, sandboxId, ...bot }, role }) => ({
      ...bot,
      role,
      groupOwned: groupChatId === chat.id,
      hasSandbox: Boolean(sandboxId),
    })
  )
  const bot = chat.kind === "direct" ? (members[0] ?? null) : null
  // Direct chats have no name of their own; they show the bot's.
  return {
    ...rest,
    title: chat.name ?? members[0]?.name ?? "Untitled chat",
    members,
    bot,
  }
})

export type ChatWithBot = NonNullable<Awaited<ReturnType<typeof getChat>>>

// The user's ratings of a chat's answers, by message ID. Empty for a chat
// that isn't theirs.
export async function getChatRatings(chatId: string) {
  if (!(await getChat(chatId))) return {}
  const rows = await db.query.messageRatings.findMany({
    where: (ratings, { eq }) => eq(ratings.chatId, chatId),
    columns: { messageId: true, rating: true },
  })
  return Object.fromEntries(
    rows.map(({ messageId, rating }) => [messageId, rating])
  ) as Record<string, MessageRating>
}

// How one of the user's groups governs itself, for its page: roles and
// constitution, flags, tasks, votes and the moderation record, each bot's
// role and standing, and whether it's on autopilot. Null for a chat that
// isn't the user's group. The shared memory stays out: it's for the bots,
// not the page.
export async function getGroupOverview(chatId: string) {
  const chat = await getChat(chatId)
  if (chat?.kind !== "group") return null
  const state = await loadGroupState(chatId)
  return {
    roles: state.roles.map(({ id, kind, name, description, permissions }) => ({
      id,
      kind,
      name,
      description,
      permissions,
    })),
    constitution: state.constitution,
    constitutionUpdatedAt: state.constitutionUpdatedAt,
    members: state.members.map((member) => ({
      id: member.id,
      role: member.role,
      suspendedUntil: member.suspendedUntil,
      restricted: member.role.permissions.filter(
        (permission) => !member.permissions.includes(permission)
      ),
    })),
    flags: state.flags,
    tasks: state.tasks,
    votes: state.votes,
    actions: state.actions,
    autopilot: state.autopilot,
    autopilotTurns: state.autopilotTurns,
  }
}

export type GroupOverview = NonNullable<
  Awaited<ReturnType<typeof getGroupOverview>>
>

// The spend limits that apply to one of the user's chats, what's been spent
// against each, and autopilot's run of turns. Null for a chat that isn't
// theirs.
export async function getChatBudget(chatId: string) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !(await getChat(chatId))) return null
  const [limits, spend] = await Promise.all([
    loadLimits(userId),
    spendOf(userId, chatId),
  ])
  return {
    ...budgetOf(limits, spend),
    warnAtPercent: limits.warnAtPercent,
    maxAutopilotTurns: limits.maxAutopilotTurns,
  }
}

export type ChatBudget = NonNullable<Awaited<ReturnType<typeof getChatBudget>>>

const TIMELINE_LENGTH = 200

export async function getChatTimeline(chatId: string) {
  if (!(await getChat(chatId))) return []
  return db.query.chatEvents.findMany({
    where: eq(chatEvents.chatId, chatId),
    orderBy: [desc(chatEvents.createdAt)],
    limit: TIMELINE_LENGTH,
  })
}
