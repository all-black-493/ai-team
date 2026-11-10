import "server-only"

import { cache } from "react"
import { auth } from "@clerk/nextjs/server"

import { loadGroupState } from "@/chats/governance-data"
import { db } from "@/db"
import type { MessageRating } from "@/db/schema"

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
  const members = rows.map(({ bot: { groupChatId, ...bot }, role }) => ({
    ...bot,
    role,
    groupOwned: groupChatId === chat.id,
  }))
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
// constitution, flags, tasks and the moderation record, and each bot's role
// and standing. Null for a chat that isn't the user's group. The shared memory
// stays out: it's for the bots, not the page.
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
    actions: state.actions,
  }
}

export type GroupOverview = NonNullable<
  Awaited<ReturnType<typeof getGroupOverview>>
>
