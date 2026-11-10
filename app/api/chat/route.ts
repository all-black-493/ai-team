import { neon } from "@neon/ai-sdk-provider"
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai"

import { getChat } from "@/chats/queries"

// The chat's bot answers through the Neon AI Gateway, which reads
// NEON_AI_GATEWAY_BASE_URL and NEON_AI_GATEWAY_TOKEN (`neon env pull`).
// Nothing is saved: useChat sends the whole conversation every time.
export async function POST(req: Request) {
  const { id, messages }: { id: unknown; messages: UIMessage[] } =
    await req.json()
  if (typeof id !== "string") {
    return new Response("Missing chat ID", { status: 400 })
  }

  // Scoped to the signed-in Clerk user, like the chat page: a missing
  // chat, someone else's, and no session all look the same.
  const chat = await getChat(id)
  if (!chat?.bot) {
    return new Response("Chat not found", { status: 404 })
  }

  const { name, job, instructions } = chat.bot
  const result = streamText({
    model: neon("claude-sonnet-5-5"),
    // Edits in the bot dialog apply from the next message.
    system: [`You are ${name}. Your job: ${job}.`, instructions]
      .filter(Boolean)
      .join("\n\n"),
    messages: await convertToModelMessages(messages),
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  })
}
