import "server-only"

import { cache } from "react"
import { auth } from "@clerk/nextjs/server"

import { db } from "@/db"
import type { MessageRating } from "@/db/schema"

// One of the signed-in user's chats, or null when it doesn't exist, belongs to
// someone else, or nobody is signed in. The user ID comes from the Clerk
// session, never from a caller. `members` are its bots in the order they
// joined; `bot` is a direct chat's one bot, and null for a group.
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
            },
          },
        },
      },
    },
  })
  if (!chat) return null

  const { members: rows, ...rest } = chat
  const members = rows.map((row) => row.bot)
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
