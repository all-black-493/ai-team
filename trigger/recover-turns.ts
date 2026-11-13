import { logger, schedules } from "@trigger.dev/sdk"
import { AgentChat } from "@trigger.dev/sdk/chat"

import { turnsToRecover } from "@/chats/turns-data"
import { LIMIT_CEILINGS } from "@/lib/budget"
import type { botChat } from "@/trigger/chat"

// Picks up turns the chat runs on its own that were claimed but cut off:
// the browser closed, the stream dropped or the run died. Each chat is asked
// to carry on once, and the agent runs the claimed turn again from the
// ledger, so nothing is decided twice. Running turns get the longest time a
// user can allow before they count as cut off.
export const recoverTurns = schedules.task({
  id: "recover-turns",
  cron: { pattern: "*/5 * * * *", window: "5m" },
  maxDuration: 120,
  run: async () => {
    const stuck = await turnsToRecover(LIMIT_CEILINGS.maxTaskMinutes)
    const chatIds = [...new Set(stuck.map((turn) => turn.chatId))]
    for (const chatId of chatIds) {
      const agent = new AgentChat<typeof botChat>({
        agent: "bot-chat",
        id: chatId,
        clientData: { auto: true },
      })
      try {
        const stream = await agent.sendAction({ type: "continue" })
        // The turn runs and is saved whether or not anyone reads it.
        await stream.stream.cancel()
      } catch (error) {
        logger.warn("Couldn't ask a chat to carry on", { chatId, error })
      }
    }
    return { chats: chatIds.length }
  },
})
