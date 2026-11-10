import "server-only"

import { cache } from "react"
import { auth } from "@clerk/nextjs/server"

import { db } from "@/db"

// One of the signed-in user's chats, or null when it doesn't exist, belongs to
// someone else, or nobody is signed in. The user ID comes from the Clerk
// session, never from a caller. The chat is fronted by its first member's bot:
// a direct chat's only bot, or for now the first bot to join a group.
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
        limit: 1,
        columns: {},
        // Everything the edit dialog needs, too.
        with: {
          bot: {
            columns: {
              id: true,
              name: true,
              avatar: true,
              job: true,
              instructions: true,
            },
          },
        },
      },
    },
  })
  if (!chat) return null

  const { members, ...rest } = chat
  const bot = members[0]?.bot ?? null
  // Direct chats have no name of their own; they show the bot's.
  return { ...rest, title: chat.name ?? bot?.name ?? "Untitled chat", bot }
})

export type ChatWithBot = NonNullable<Awaited<ReturnType<typeof getChat>>>
