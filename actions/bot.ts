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
import { isModelId } from "@/lib/models"
import {
  applySandboxPolicy,
  createBotSandbox,
  deleteBotSandbox,
  type SandboxPolicy,
} from "@/lib/sandbox"
import { SANDBOX_DEFAULTS } from "@/lib/sandbox-policy"

// Server Function arguments come straight from the client.
const botIdSchema = z.string().min(1)
const modelSchema = z.string().refine(isModelId, "Not a model bots can use")

function policyOf(values: BotInsert): SandboxPolicy {
  return {
    networkPolicy: values.networkPolicy ?? "default",
    allowedDomains: values.allowedDomains || null,
    autoStopMinutes: values.autoStopMinutes ?? SANDBOX_DEFAULTS.autoStopMinutes,
    autoArchiveDays: values.autoArchiveDays ?? SANDBOX_DEFAULTS.autoArchiveDays,
  }
}

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
  const policy = policyOf(values)
  const sandboxId = await createBotSandbox(policy, { userId })

  // Every bot starts with a direct chat. One transaction, so a failure
  // leaves no bot without its chat. (node-postgres has no db.batch.)
  const bot = await db
    .transaction(async (tx) => {
      const [bot] = await tx
        .insert(bots)
        .values({
          ...values,
          ...policy,
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
      await deleteBotSandbox(sandboxId, { userId }).catch((cleanupError) =>
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
  const policy = policyOf(values)

  // Scoped to the signed-in user: another user's bot matches no row.
  const before = await db.query.bots.findFirst({
    where: and(eq(bots.id, id), eq(bots.userId, userId)),
  })
  if (!before) {
    throw new Error("Bot not found")
  }
  const [bot] = await db
    .update(bots)
    .set({ ...values, ...policy, instructions: values.instructions || null })
    .where(and(eq(bots.id, id), eq(bots.userId, userId)))
    .returning()

  const changed = (Object.keys(policy) as (keyof SandboxPolicy)[]).some(
    (key) => policy[key] !== before[key]
  )
  const { networkError } =
    changed && bot.sandboxId
      ? await applySandboxPolicy(bot.sandboxId, policy, {
          userId,
          botId: bot.id,
        })
      : { networkError: null }

  // The bot's name and face show in the sidebar and the chat header.
  revalidatePath("/", "layout")
  return { bot, networkError }
}

// Switches the model a bot runs on, from the composer of its chat. Its next
// answer uses it.
export async function setBotModel(botId: string, model: string) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) {
    throw new Error("Unauthorized")
  }

  const id = botIdSchema.parse(botId)
  const value = modelSchema.parse(model)

  const [bot] = await db
    .update(bots)
    .set({ model: value })
    .where(and(eq(bots.id, id), eq(bots.userId, userId)))
    .returning({ id: bots.id })
  if (!bot) {
    throw new Error("Bot not found")
  }
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
      await deleteBotSandbox(bot.sandboxId, { userId, botId: bot.id })
    }
  })

  revalidatePath("/", "layout")
}
