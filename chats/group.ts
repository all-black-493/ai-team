import { getToolName, isToolUIPart, type UIMessage } from "ai"

import { DELEGATE_TOOL, VOTE_TOOL } from "@/chats/collaboration"
import { HANDOFF_TOOL } from "@/chats/handoff"

// Tools that change what the page shows of a group (trigger/group-tools.ts,
// trigger/collaboration.ts): its bots, roles, constitution, tasks, votes,
// flags or moderation. The page loads the group again after an answer uses
// one. The shared memory isn't shown, so updating it needs no reload.
const GROUP_CHANGING_TOOLS = [
  "add_group_member",
  "remove_group_member",
  "rename_group",
  "create_role",
  "update_role",
  "delete_role",
  "assign_role",
  "set_constitution",
  "propose_task",
  "update_task",
  DELEGATE_TOOL,
  VOTE_TOOL,
  "flag_message",
  "answer_flag",
  "moderate",
]

// Tools that leave another bot's turn due: a handoff's answer, a flagged
// bot's response, or a moderator's review. The chat carries on with it.
const FOLLOW_UP_TOOLS = [HANDOFF_TOOL, "flag_message", "answer_flag"]

function usedTool(message: UIMessage, names: string[]) {
  return message.parts.some(
    (part) =>
      isToolUIPart(part) &&
      part.state === "output-available" &&
      names.includes(getToolName(part))
  )
}

// Whether an answer changed its group, so the page should load it again.
export const changedGroup = (message: UIMessage) =>
  usedTool(message, GROUP_CHANGING_TOOLS)

// Whether the chat should carry on after an answer, with no new message.
export const needsFollowUp = (message: UIMessage) =>
  usedTool(message, FOLLOW_UP_TOOLS)
