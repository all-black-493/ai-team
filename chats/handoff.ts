import { getToolName, isToolUIPart, type UIMessage } from "ai"

// In a group chat, a bot can pass the user's message to another bot whose job
// fits it better: it calls this tool, its turn ends, and the other bot answers
// in a turn of its own. Shared by the agent (trigger/handoff.ts) and the chat.
export const HANDOFF_TOOL = "handoff"

// What the tool returns: who answers next, and why.
export type Handoff = { botId: string; name: string; reason: string }

// The handoff a bot's answer ended with, if it handed the message on.
export function handoffOf(message: UIMessage | undefined): Handoff | undefined {
  if (message?.role !== "assistant") return undefined
  const part = message.parts.findLast(
    (part) =>
      isToolUIPart(part) &&
      getToolName(part) === HANDOFF_TOOL &&
      part.state === "output-available"
  )
  return part && isToolUIPart(part) ? (part.output as Handoff) : undefined
}
