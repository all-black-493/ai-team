"use server"

import { auth } from "@clerk/nextjs/server"
import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { recordEvent } from "@/chats/budget-data"
import { db } from "@/db"
import { chatMembers, chats } from "@/db/schema"

const approvalSchema = z.object({
  chatId: z.string().min(1),
  botId: z.string().min(1),
  action: z.string().trim().min(1).max(300),
  approved: z.boolean(),
})

// Puts the user's answer to a bot's approval request on the chat's timeline.
// The answer itself reaches the bot through the chat.
export async function recordApproval(input: z.infer<typeof approvalSchema>) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) {
    throw new Error("Unauthorized")
  }

  const { chatId, botId, action, approved } = approvalSchema.parse(input)
  const [member] = await db
    .select({ botId: chatMembers.botId })
    .from(chatMembers)
    .innerJoin(chats, eq(chats.id, chatMembers.chatId))
    .where(
      and(
        eq(chatMembers.chatId, chatId),
        eq(chatMembers.botId, botId),
        eq(chats.userId, userId)
      )
    )
  if (!member) {
    throw new Error("Chat not found")
  }

  await recordEvent({
    chatId,
    botId,
    byUser: true,
    category: "decided",
    title: `${approved ? "Approved" : "Denied"}: ${action}`,
  })
  revalidatePath(`/chats/${chatId}`)
}
