"use server"

import { auth } from "@clerk/nextjs/server"
import { and, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import {
  botInsertSchema,
  bots,
  chatMembers,
  chats,
  type BotInsert,
} from "@/db/schema"
import { createBotSandbox, deleteBotSandbox } from "@/lib/sandbox"

// Server Function arguments come straight from the client.
const botIdSchema = z.string().min(1)

export async function createBot(input: BotInsert) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) {
    throw new Error("Unauthorized")
  }

  // Client validation is not trusted; parse again on the server.
  const values = botInsertSchema.parse(input)

  // Every bot gets its own sandbox. It's created before the transaction so
  // the slow call doesn't hold one open, and deleted again if the bot isn't
  // saved.
  const sandboxId = await createBotSandbox()

  // Every bot starts with a direct chat. One transaction, so a failure
  // leaves no bot without its chat. (node-postgres has no db.batch.)
  const bot = await db
    .transaction(async (tx) => {
      const [bot] = await tx
        .insert(bots)
        .values({
          ...values,
          instructions: values.instructions || null,
          userId,
          sandboxId,
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
    .catch(async (error) => {
      await deleteBotSandbox(sandboxId).catch((cleanupError) =>
        console.error(
          `Couldn't delete sandbox ${sandboxId} of an unsaved bot`,
          cleanupError
        )
      )
      throw error
    })

  // The new chat shows in the sidebar, which lives in the root layout.
  revalidatePath("/", "layout")
  return bot
}

export async function updateBot(botId: string, input: BotInsert) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) {
    throw new Error("Unauthorized")
  }

  const id = botIdSchema.parse(botId)
  const values = botInsertSchema.parse(input)

  // Scoped to the signed-in user: another user's bot matches no row.
  const [bot] = await db
    .update(bots)
    .set({ ...values, instructions: values.instructions || null })
    .where(and(eq(bots.id, id), eq(bots.userId, userId)))
    .returning()
  if (!bot) {
    throw new Error("Bot not found")
  }

  // The bot's name and face show in the sidebar and the chat header.
  revalidatePath("/", "layout")
  return bot
}

export async function deleteBot(botId: string) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) {
    throw new Error("Unauthorized")
  }

  const id = botIdSchema.parse(botId)

  await db.transaction(async (tx) => {
    // A direct chat is only ever with this bot, so it goes too. Delete it
    // first: removing the bot cascades away the memberships that link them.
    // Group chats stay and just lose the bot.
    await tx
      .delete(chats)
      .where(
        and(
          eq(chats.userId, userId),
          eq(chats.kind, "direct"),
          inArray(
            chats.id,
            tx
              .select({ id: chatMembers.chatId })
              .from(chatMembers)
              .where(eq(chatMembers.botId, id))
          )
        )
      )

    const [bot] = await tx
      .delete(bots)
      .where(and(eq(bots.id, id), eq(bots.userId, userId)))
      .returning({ id: bots.id, sandboxId: bots.sandboxId })
    // Not this user's bot: throwing rolls back the chat delete above.
    if (!bot) {
      throw new Error("Bot not found")
    }

    // Last, and inside the transaction: if the sandbox can't be deleted, the
    // bot isn't either, and deleting it again retries both.
    if (bot.sandboxId) {
      await deleteBotSandbox(bot.sandboxId)
    }
  })

  revalidatePath("/", "layout")
}
