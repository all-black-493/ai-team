"use server"

import { auth } from "@trigger.dev/sdk"
import { chat, defaultStorage } from "@trigger.dev/sdk/ai"
import { del, get } from "@vercel/blob"
import type { FileUIPart } from "ai"
import { nanoid } from "nanoid"

import { attachmentPrefix, MAX_ATTACHMENT_BYTES } from "@/chats/attachments"
import { getChatBot } from "@/chats/bot"
import { getChat } from "@/chats/queries"
import { getStartedSandbox } from "@/lib/sandbox"
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
// (app/api/chat-uploads), into the chat's bot's sandbox, then deletes it from
// Blob. The message carries only a sandbox: reference: the chat stream caps
// each record at about 1 MiB, and the bot opens the file with its own tools.
export async function attachChatFile(
  chatId: string,
  upload: { pathname: string; filename: string; mediaType: string }
): Promise<FileUIPart> {
  await assertOwnChat(chatId)
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

  const { sandboxId } = await getChatBot(chatId)
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
