"use server"

import { auth } from "@trigger.dev/sdk"
import { chat, defaultStorage } from "@trigger.dev/sdk/ai"

import { getChat } from "@/chats/queries"
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
