import { db } from "@/db"

// A chat's bot: its first member, which for a direct chat is its only bot.
// Not scoped to a user, so callers check who's asking first. There's no
// "server-only" guard because the Trigger.dev agent imports this too, and that
// package throws outside React's server environment.
export async function getChatBot(chatId: string) {
  const member = await db.query.chatMembers.findFirst({
    where: (members, { eq }) => eq(members.chatId, chatId),
    orderBy: (members, { asc }) => [asc(members.joinedAt)],
    columns: {},
    with: {
      bot: {
        columns: {
          name: true,
          job: true,
          instructions: true,
          sandboxId: true,
        },
      },
    },
  })
  if (!member) {
    throw new Error(`Chat ${chatId} has no bot`)
  }
  return member.bot
}
