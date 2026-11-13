import { isToolUIPart, type UIMessage } from "ai"

export function awaitsApproval(message: UIMessage | undefined) {
  return (
    message?.role === "assistant" &&
    message.parts.some(
      (part) => isToolUIPart(part) && part.state === "approval-requested"
    )
  )
}

// Whether the user has answered every approval an answer waited for, so
// the next turn is that bot's, carrying on.
export function answeredApprovals(message: UIMessage | undefined) {
  if (message?.role !== "assistant") return false
  const tools = message.parts.filter(isToolUIPart)
  return (
    tools.some((part) => part.state === "approval-responded") &&
    !tools.some((part) => part.state === "approval-requested")
  )
}
