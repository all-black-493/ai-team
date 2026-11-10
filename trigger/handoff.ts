import { tool } from "ai"
import { z } from "zod"

import type { Handoff } from "@/chats/handoff"

type GroupBot = { id: string; name: string; job: string }

// The handoff tool, offered to a bot in a group chat, for the other bots in
// it. It changes nothing: its result tells the chat which bot to ask next,
// and the turn ends there (see the stop condition in trigger/chat.ts).
export function createHandoffTool(others: GroupBot[]) {
  const names = others.map((bot) => bot.name).join(", ")
  return tool({
    description: `Hand the user's latest message to another bot in this group chat whose job fits it better than yours. They answer it straight after you. First tell the user in one short sentence who you're handing it to and why, then call this, and don't answer the message yourself. The bots you can hand to: ${names}.`,
    inputSchema: z.object({
      to: z.string().describe("The other bot's name, as listed in this chat"),
      reason: z
        .string()
        .describe(
          "Why their job fits the message better than yours, in a short phrase"
        ),
    }),
    execute: async ({ to, reason }): Promise<Handoff> => {
      const name = to.trim().toLowerCase()
      const target = others.find((bot) => bot.name.toLowerCase() === name)
      if (!target) {
        throw new Error(
          `There's no other bot named "${to}" in this chat. Pick one of: ${names}.`
        )
      }
      return { botId: target.id, name: target.name, reason }
    },
  })
}
