"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"

import { db } from "@/db"
import { botInsertSchema, bots, type BotInsert } from "@/db/schema"

export async function createBot(input: BotInsert) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) {
    throw new Error("Unauthorized")
  }

  // Client validation is not trusted; parse again on the server.
  const values = botInsertSchema.parse(input)

  const [bot] = await db
    .insert(bots)
    .values({
      ...values,
      instructions: values.instructions || null,
      userId,
    })
    .returning()

  revalidatePath("/")
  return bot
}
