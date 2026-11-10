import "server-only"

import { cache } from "react"
import { auth } from "@clerk/nextjs/server"

import { db } from "@/db"

// The signed-in user's chats, most recent activity first. The user ID comes
// from the Clerk session, never from a caller. Each chat carries its bots in
// the order they joined: a direct chat's one bot, or a group's members.
// cache() lets the sidebar list and the search share one query per request.
export const getUserChats = cache(async () => {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) return []

  const rows = await db.query.chats.findMany({
    where: (chats, { eq }) => eq(chats.userId, userId),
    orderBy: (chats, { desc }) => [desc(chats.lastMessageAt)],
    columns: {
      id: true,
      kind: true,
      name: true,
      lastMessagePreview: true,
      lastMessageAt: true,
    },
    with: {
      members: {
        orderBy: (members, { asc }) => [asc(members.joinedAt)],
        columns: {},
        with: { bot: { columns: { id: true, name: true, avatar: true } } },
      },
    },
  })

  return rows.map(({ members, ...chat }) => {
    const bots = members.map((member) => member.bot)
    // Direct chats have no name of their own; they show the bot's.
    return {
      ...chat,
      title: chat.name ?? bots[0]?.name ?? "Untitled chat",
      members: bots,
    }
  })
})

export type UserChat = Awaited<ReturnType<typeof getUserChats>>[number]

// The signed-in user's bots, oldest first, for picking a group's members.
// Not the bots a group owns, such as its moderator.
export const getUserBots = cache(async () => {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) return []

  return db.query.bots.findMany({
    where: (bots, { and, eq, isNull }) =>
      and(eq(bots.userId, userId), isNull(bots.groupChatId)),
    orderBy: (bots, { asc }) => [asc(bots.createdAt)],
    columns: { id: true, name: true, avatar: true },
  })
})

export type UserBot = Awaited<ReturnType<typeof getUserBots>>[number]
