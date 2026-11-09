import "server-only"

import { cache } from "react"
import { auth } from "@clerk/nextjs/server"

import { db } from "@/db"

// The signed-in user's chats, most recent activity first. The user ID comes
// from the Clerk session, never from a caller. Each chat carries the bot that
// fronts it: a direct chat's only member, or for now the first bot to join a
// group. cache() lets the sidebar list and the search share one query per
// request.
export const getUserChats = cache(async () => {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) return []

  const rows = await db.query.chats.findMany({
    where: (chats, { eq }) => eq(chats.userId, userId),
    orderBy: (chats, { desc }) => [desc(chats.lastMessageAt)],
    columns: {
      id: true,
      name: true,
      lastMessagePreview: true,
      lastMessageAt: true,
    },
    with: {
      members: {
        orderBy: (members, { asc }) => [asc(members.joinedAt)],
        limit: 1,
        columns: {},
        with: { bot: { columns: { name: true, avatar: true } } },
      },
    },
  })

  return rows.map(({ members, ...chat }) => {
    const bot = members[0]?.bot ?? null
    // Direct chats have no name of their own; they show the bot's.
    return { ...chat, title: chat.name ?? bot?.name ?? "Untitled chat", bot }
  })
})

export type UserChat = Awaited<ReturnType<typeof getUserChats>>[number]
