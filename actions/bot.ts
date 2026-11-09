"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"

import { db } from "@/db"
import {
  botInsertSchema,
  bots,
  chatMembers,
  chats,
  type BotInsert,
} from "@/db/schema"

export async function createBot(input: BotInsert) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) {
    throw new Error("Unauthorized")
  }

  // Client validation is not trusted; parse again on the server.
  const values = botInsertSchema.parse(input)

  // Every bot starts with a direct chat. One transaction, so a failure
  // leaves no bot without its chat. (node-postgres has no db.batch.)
  const bot = await db.transaction(async (tx) => {
    const [bot] = await tx
      .insert(bots)
      .values({
        ...values,
        instructions: values.instructions || null,
        userId,
      })
      .returning()

    // Direct chats have no name of their own; they show the bot's.
    const [chat] = await tx
      .insert(chats)
      .values({ userId, kind: "direct" })
      .returning({ id: chats.id })

    await tx.insert(chatMembers).values({ chatId: chat.id, botId: bot.id })

    return bot
  })

  revalidatePath("/")
  return bot
}
