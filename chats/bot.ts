import { db } from "@/db"

// These aren't scoped to a user, so callers check who's asking first. There's
// no "server-only" guard because the Trigger.dev agent imports them too, and
// that package throws outside React's server environment.

const botColumns = {
  id: true,
  name: true,
  job: true,
  instructions: true,
  model: true,
  sandboxId: true,
  desktopUrl: true,
  desktopUrlExpiresAt: true,
} as const

// One of a chat's bots: the one with `botId`, which has to be a member, or
// without it the first to join (a direct chat's only bot).
export async function getChatBot(chatId: string, botId?: string) {
  const member = await db.query.chatMembers.findFirst({
    where: (members, { and, eq }) =>
      botId
        ? and(eq(members.chatId, chatId), eq(members.botId, botId))
        : eq(members.chatId, chatId),
    orderBy: (members, { asc }) => [asc(members.joinedAt)],
    columns: {},
    with: { bot: { columns: botColumns } },
  })
  if (!member) {
    throw new Error(
      botId
        ? `Bot ${botId} isn't in chat ${chatId}`
        : `Chat ${chatId} has no bot`
    )
  }
  return member.bot
}

// The chat itself, with its bots in the order they joined: what a bot needs
// to know about who else is in a group.
export async function getChatWithMembers(chatId: string) {
  const chat = await db.query.chats.findFirst({
    where: (chats, { eq }) => eq(chats.id, chatId),
    columns: { kind: true, name: true },
    with: {
      members: {
        orderBy: (members, { asc }) => [asc(members.joinedAt)],
        columns: {},
        with: { bot: { columns: { id: true, name: true, job: true } } },
      },
    },
  })
  if (!chat) {
    throw new Error(`Chat ${chatId} not found`)
  }
  return {
    kind: chat.kind,
    name: chat.name,
    members: chat.members.map((member) => member.bot),
  }
}
