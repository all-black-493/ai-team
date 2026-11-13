"use server"

import { auth as clerkAuth } from "@clerk/nextjs/server"
import { auth } from "@trigger.dev/sdk"
import { chat, defaultStorage } from "@trigger.dev/sdk/ai"
import { del, get } from "@vercel/blob"
import { and, eq } from "drizzle-orm"
import type { FileUIPart } from "ai"
import { nanoid } from "nanoid"
import { z } from "zod"

import { attachmentPrefix, MAX_ATTACHMENT_BYTES } from "@/chats/attachments"
import { getChatBot } from "@/chats/bot"
import { db } from "@/db"
import { bots, messageRatings, type MessageRating } from "@/db/schema"
import { getChat } from "@/chats/queries"
import {
  getStartedSandbox,
  signDesktopUrl,
  startBotDesktop,
} from "@/lib/sandbox"
import type { botChat } from "@/trigger/chat"

const startSession = chat.createStartSessionAction<typeof botChat>("bot-chat")
const loadTranscript = chat.createLoadTranscriptAction(defaultStorage)

// The chat ID comes from the browser. getChat is scoped to the signed-in
// Clerk user, so another user's chat, or no session, is rejected here.
async function assertOwnChat(chatId: string) {
  if (!(await getChat(chatId))) {
    throw new Error("Chat not found")
  }
}

// Creates the chat's Trigger.dev session and first run, or returns the
// existing one: idempotent on the chat ID.
export async function startChatSession(chatId: string) {
  await assertOwnChat(chatId)
  return startSession({ chatId })
}

// The transport calls this to refresh an expired session token.
export async function mintChatAccessToken(chatId: string) {
  await assertOwnChat(chatId)
  return auth.createPublicToken({
    scopes: { read: { sessions: chatId }, write: { sessions: chatId } },
    expirationTime: "1h",
  })
}

// The conversation so far, from the agent's transcript storage.
export async function loadChatTranscript({ chatId }: { chatId: string }) {
  await assertOwnChat(chatId)
  // `state` is the model's internal context; the browser only renders.
  const { messages, cursors, nextCursor } = await loadTranscript({ chatId })
  return { messages, cursors, nextCursor }
}

// Moves a file the user attached, already uploaded to the private Blob store
// (app/api/chat-uploads), into the sandbox of the bot the message is for,
// then deletes it from Blob. The message carries only a sandbox: reference:
// the chat stream caps each record at about 1 MiB, and the bot opens the
// file with its own tools.
export async function attachChatFile(
  chatId: string,
  botId: string,
  upload: { pathname: string; filename: string; mediaType: string }
): Promise<FileUIPart> {
  await assertOwnChat(chatId)
  if (typeof botId !== "string" || !botId) {
    throw new Error("No bot")
  }
  if (
    !upload.pathname.startsWith(attachmentPrefix(chatId)) ||
    upload.pathname.includes("..")
  ) {
    throw new Error("Not this chat's file")
  }

  const blob = await get(upload.pathname, { access: "private" })
  if (!blob || blob.statusCode !== 200 || !blob.stream) {
    throw new Error("Upload not found")
  }
  const bytes = Buffer.from(await new Response(blob.stream).arrayBuffer())
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new Error("File too large")
  }

  // Throws for a bot that isn't in this chat.
  const { sandboxId } = await getChatBot(chatId, botId)
  if (!sandboxId) {
    throw new Error("This bot has no sandbox")
  }
  const sandbox = await getStartedSandbox(sandboxId)
  const home = (await sandbox.getUserHomeDir()) ?? "/home/daytona"
  // A prefix keeps two files with the same name apart.
  const name =
    upload.filename.replaceAll(/[^\w.-]+/g, "_").slice(-100) || "file"
  const path = `${home}/uploads/${nanoid(6)}-${name}`
  await sandbox.process.executeCommand(`mkdir -p '${home}/uploads'`)
  await sandbox.fs.uploadFile(bytes, path)
  // Blob was only the way in; the sandbox keeps the file.
  await del(upload.pathname)

  return {
    type: "file",
    mediaType: upload.mediaType || "application/octet-stream",
    filename: upload.filename,
    url: `sandbox:${path}`,
  }
}

// The longest Daytona allows, and how close to expiring a kept link is
// replaced rather than handed out.
const DESKTOP_URL_SECONDS = 24 * 60 * 60
const DESKTOP_URL_MARGIN_MS = 60 * 60 * 1000

// One of the chat's bots' desktop, for the chat's desktop panel: starts it
// if needed and returns a signed noVNC link. The link is kept on the bot and
// reused, since Daytona's preview warning comes up once for each new link.
export async function openChatDesktop(chatId: string, botId?: string) {
  const chat = await getChat(chatId)
  const wanted = z.string().min(1).optional().parse(botId)
  const member = wanted
    ? chat?.members.find((member) => member.id === wanted)
    : chat?.members[0]
  if (!member) {
    throw new Error("Chat not found")
  }
  const bot = await getChatBot(chatId, member.id)
  if (!bot.sandboxId) {
    throw new Error("This bot has no sandbox")
  }
  const { userId } = await clerkAuth()
  const sandbox = await startBotDesktop(bot.sandboxId, {
    userId,
    botId: bot.id,
  })
  if (
    bot.desktopUrl &&
    bot.desktopUrlExpiresAt &&
    bot.desktopUrlExpiresAt.getTime() > Date.now() + DESKTOP_URL_MARGIN_MS
  ) {
    return bot.desktopUrl
  }
  const url = await signDesktopUrl(sandbox, DESKTOP_URL_SECONDS)
  await db
    .update(bots)
    .set({
      desktopUrl: url,
      desktopUrlExpiresAt: new Date(Date.now() + DESKTOP_URL_SECONDS * 1000),
    })
    .where(eq(bots.id, bot.id))
  return url
}

// Thumbs up or down on one of the chat's answers; null takes it back.
export async function rateChatMessage(
  chatId: string,
  messageId: string,
  rating: MessageRating | null
) {
  await assertOwnChat(chatId)
  if (typeof messageId !== "string" || !messageId) {
    throw new Error("No message")
  }
  if (rating === null) {
    await db
      .delete(messageRatings)
      .where(
        and(
          eq(messageRatings.chatId, chatId),
          eq(messageRatings.messageId, messageId)
        )
      )
    return
  }
  if (rating !== "up" && rating !== "down") {
    throw new Error("Not a rating")
  }
  await db
    .insert(messageRatings)
    .values({ chatId, messageId, rating })
    .onConflictDoUpdate({
      target: [messageRatings.chatId, messageRatings.messageId],
      set: { rating, ratedAt: new Date() },
    })
}
