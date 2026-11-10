import { neon } from "@neon/ai-sdk-provider"
import { chat } from "@trigger.dev/sdk/ai"

import { db } from "@/db"

// One durable run per chat, keyed by the chat's ID. The conversation is kept
// in the agent's default transcript storage, also keyed by chat ID, so each
// turn gets the history without the browser sending it. The chat's owner is
// checked in actions/chat.ts before a session or token is handed out.
export const botChat = chat.agent({
  id: "bot-chat",
  run: async ({ chatId, messages, signal, streamText }) => {
    const { name, job, instructions } = await getChatBot(chatId)

    // The run argument's streamText, not the one from "ai".
    return streamText({
      model: neon("claude-sonnet-5-5"),
      // Read every turn, so edits in the bot dialog apply from the next message.
      system: [`You are ${name}. Your job: ${job}.`, instructions]
        .filter(Boolean)
        .join("\n\n"),
      messages,
      abortSignal: signal,
    })
  },
})

// The chat's first member: a direct chat's only bot.
async function getChatBot(chatId: string) {
  const member = await db.query.chatMembers.findFirst({
    where: (members, { eq }) => eq(members.chatId, chatId),
    orderBy: (members, { asc }) => [asc(members.joinedAt)],
    columns: {},
    with: { bot: { columns: { name: true, job: true, instructions: true } } },
  })
  if (!member) {
    throw new Error(`Chat ${chatId} has no bot`)
  }
  return member.bot
}
