"use server"

import { auth } from "@clerk/nextjs/server"
import { and, eq, inArray, isNull, notInArray, or } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import {
  bots,
  chatMembers,
  chats,
  groupChatInsertSchema,
  groupRoles,
  messageFlagInsertSchema,
  messageFlags,
  type GroupChatInsert,
  type MessageFlagInsert,
} from "@/db/schema"
import {
  BUILT_IN_ROLES,
  DEFAULT_MODERATOR,
  type BuiltInRole,
} from "@/lib/governance"

// Server Function arguments come straight from the client.
const chatIdSchema = z.string().min(1)

const isBuiltIn = (kind: string | undefined): kind is BuiltInRole =>
  kind !== undefined && kind in BUILT_IN_ROLES

// Only the user's own bots, and none that belong to a group: any other ID
// matches no row, and throws.
async function assertOwnBots(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  botIds: string[]
) {
  const owned = await tx
    .select({ id: bots.id })
    .from(bots)
    .where(
      and(
        eq(bots.userId, userId),
        isNull(bots.groupChatId),
        inArray(bots.id, botIds)
      )
    )
  if (owned.length !== botIds.length) {
    throw new Error("Bot not found")
  }
}

// A named chat with two or more of the user's bots, each in the built-in
// role picked for it. Every group also gets the built-in roles and a
// moderator bot of its own, to keep it to its constitution. Returns the
// chat, to open it.
export async function createGroupChat(input: GroupChatInsert) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) {
    throw new Error("Unauthorized")
  }

  const { name, botIds, roles } = groupChatInsertSchema.parse(input)

  const chat = await db.transaction(async (tx) => {
    await assertOwnBots(tx, userId, botIds)

    const [chat] = await tx
      .insert(chats)
      .values({ userId, kind: "group", name })
      .returning()

    const created = await tx
      .insert(groupRoles)
      .values(
        (Object.keys(BUILT_IN_ROLES) as BuiltInRole[]).map((kind) => ({
          chatId: chat.id,
          kind,
          name: BUILT_IN_ROLES[kind].name,
          description: BUILT_IN_ROLES[kind].description,
          permissions: [...BUILT_IN_ROLES[kind].permissions],
        }))
      )
      .returning({ id: groupRoles.id, kind: groupRoles.kind })
    const roleId = (kind: BuiltInRole) =>
      created.find((role) => role.kind === kind)?.id

    // No sandbox and no chat of its own: it belongs to this group alone.
    const [moderator] = await tx
      .insert(bots)
      .values({ userId, ...DEFAULT_MODERATOR, groupChatId: chat.id })
      .returning({ id: bots.id })

    // A millisecond apart, so the members keep the order they were picked
    // in, with the moderator last: chats list them by when they joined.
    const joinedAt = Date.now()
    await tx.insert(chatMembers).values([
      ...botIds.map((botId, index) => {
        const kind = roles[botId]
        return {
          chatId: chat.id,
          botId,
          roleId: roleId(isBuiltIn(kind) ? kind : "member"),
          joinedAt: new Date(joinedAt + index),
        }
      }),
      {
        chatId: chat.id,
        botId: moderator.id,
        roleId: roleId("moderator"),
        joinedAt: new Date(joinedAt + botIds.length),
      },
    ])

    return chat
  })

  revalidatePath("/", "layout")
  return chat
}

// The group settings: its name, the user's bots in it and every bot's role.
// The group's own bots, such as its moderator, always stay. Bots that stay
// keep their place in the order; new ones join at the end. Returns the chat.
export async function updateGroupChat(chatId: string, input: GroupChatInsert) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) {
    throw new Error("Unauthorized")
  }

  const id = chatIdSchema.parse(chatId)
  const { name, botIds, roles } = groupChatInsertSchema.parse(input)

  const chat = await db.transaction(async (tx) => {
    // Scoped to the signed-in user: another user's chat matches no row.
    const [chat] = await tx
      .update(chats)
      .set({ name })
      .where(
        and(eq(chats.id, id), eq(chats.userId, userId), eq(chats.kind, "group"))
      )
      .returning()
    if (!chat) {
      throw new Error("Group not found")
    }
    await assertOwnBots(tx, userId, botIds)

    const groupRoleIds = await tx
      .select({ id: groupRoles.id, kind: groupRoles.kind })
      .from(groupRoles)
      .where(eq(groupRoles.chatId, id))
    const member = groupRoleIds.find((role) => role.kind === "member")?.id
    // A role from this group, or Member for anything else.
    const roleFor = (botId: string) =>
      groupRoleIds.some((role) => role.id === roles[botId])
        ? roles[botId]
        : member

    const own = await tx
      .select({ id: bots.id })
      .from(bots)
      .where(eq(bots.groupChatId, id))
    const kept = [...botIds, ...own.map((bot) => bot.id)]

    await tx
      .delete(chatMembers)
      .where(
        and(eq(chatMembers.chatId, id), notInArray(chatMembers.botId, kept))
      )
    const joinedAt = Date.now()
    for (const [index, botId] of botIds.entries()) {
      const roleId = roleFor(botId)
      await tx
        .insert(chatMembers)
        .values({
          chatId: id,
          botId,
          roleId,
          joinedAt: new Date(joinedAt + index),
        })
        .onConflictDoUpdate({
          target: [chatMembers.chatId, chatMembers.botId],
          set: { roleId },
        })
    }
    for (const { id: botId } of own) {
      if (!roles[botId]) continue
      await tx
        .update(chatMembers)
        .set({ roleId: roleFor(botId) })
        .where(and(eq(chatMembers.chatId, id), eq(chatMembers.botId, botId)))
    }
    return chat
  })

  revalidatePath("/", "layout")
  return chat
}

// Deletes a group chat and its messages, with its roles, flags, tasks and
// own bots. The user's bots stay, with their sandboxes and memories.
export async function deleteGroupChat(chatId: string) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) {
    throw new Error("Unauthorized")
  }

  const id = chatIdSchema.parse(chatId)
  const [chat] = await db
    .delete(chats)
    .where(
      and(eq(chats.id, id), eq(chats.userId, userId), eq(chats.kind, "group"))
    )
    .returning({ id: chats.id })
  if (!chat) {
    throw new Error("Group not found")
  }

  revalidatePath("/", "layout")
}

// The user flags a bot's message in one of their groups. The bot answers it
// first, then a moderator reviews it: the chat carries on with those turns.
// Returns the flag.
export async function flagMessage(chatId: string, input: MessageFlagInsert) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) {
    throw new Error("Unauthorized")
  }

  const id = chatIdSchema.parse(chatId)
  const { messageId, botId, rule, reason } =
    messageFlagInsertSchema.parse(input)

  const flag = await db.transaction(async (tx) => {
    // Scoped to the signed-in user, and to a bot in the group.
    const [member] = await tx
      .select({ botId: chatMembers.botId })
      .from(chatMembers)
      .innerJoin(chats, eq(chats.id, chatMembers.chatId))
      .where(
        and(
          eq(chatMembers.chatId, id),
          eq(chatMembers.botId, botId),
          eq(chats.userId, userId),
          eq(chats.kind, "group")
        )
      )
    if (!member) {
      throw new Error("Bot not found")
    }
    const [open] = await tx
      .select({ id: messageFlags.id })
      .from(messageFlags)
      .where(
        and(
          eq(messageFlags.chatId, id),
          eq(messageFlags.messageId, messageId),
          or(
            eq(messageFlags.status, "awaiting_response"),
            eq(messageFlags.status, "awaiting_review")
          )
        )
      )
    if (open) {
      throw new Error("Already flagged")
    }
    const [flag] = await tx
      .insert(messageFlags)
      .values({ chatId: id, messageId, botId, rule: rule || null, reason })
      .returning()
    return flag
  })

  revalidatePath(`/chats/${id}`)
  return flag
}

// Puts one of the user's groups on autopilot, or takes it off. On autopilot
// its bots carry on together after each answer, without waiting for the
// user. Returns whether it's on.
export async function setAutopilot(chatId: string, on: boolean) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) {
    throw new Error("Unauthorized")
  }

  const id = chatIdSchema.parse(chatId)
  const [chat] = await db
    .update(chats)
    .set({ autopilot: z.boolean().parse(on) })
    .where(
      and(eq(chats.id, id), eq(chats.userId, userId), eq(chats.kind, "group"))
    )
    .returning({ autopilot: chats.autopilot })
  if (!chat) {
    throw new Error("Group not found")
  }

  revalidatePath(`/chats/${id}`)
  return chat.autopilot
}
