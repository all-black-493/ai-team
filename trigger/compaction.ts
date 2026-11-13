import { generateText, type ModelMessage, type UIMessage } from "ai"
import { desc, eq } from "drizzle-orm"

import { recordEvent, recordUsage } from "@/chats/budget-data"
import { db } from "@/db"
import { chatSummaries } from "@/db/schema"
import { metadataOf, summaryNote, transcriptOf } from "@/trigger/context"
import { languageModel, modelProviderOptions } from "@/trigger/models"

const SUMMARY_MODEL = "claude-haiku-5-5"
// The latest messages always stay as they are.
const KEEP_RECENT = 6

const SUMMARY_SYSTEM = `You compact a chat between a user and their AI bots, so the bots can carry on from your summary instead of the messages it replaces.

Keep everything that matters later: facts about the user and their work, preferences, decisions and why they were made, tasks with who owns them and where they stand, commitments, open questions, and specifics such as names, numbers, dates, files, commands and links. When a summary so far is given, carry over what still holds and fold in what's new.

Drop greetings, thanks, repetition and step-by-step tool chatter. Write short Markdown sections with bullet points, and say which bot said or did what.`

// How big the conversation was at its latest answer, in tokens, or a rough
// count of what's there.
function sizeOf(messages: UIMessage[]) {
  const answer = messages.findLast(
    (message) =>
      message.role === "assistant" && metadataOf(message)?.contextTokens
  )
  return answer
    ? (metadataOf(answer)?.contextTokens ?? 0)
    : Math.round(JSON.stringify(messages).length / 4)
}

// The conversation a turn works from: the latest summary, then the messages
// after it. Once that passes `threshold` tokens, the older of those messages
// are summarized too, and the new summary is kept with the earlier ones.
export async function compactedHistory({
  chatId,
  userId,
  history,
  names,
  threshold,
}: {
  chatId: string
  userId: string
  history: UIMessage[]
  names: Map<string, string>
  threshold: number | null
}) {
  const latest = await db.query.chatSummaries.findFirst({
    where: eq(chatSummaries.chatId, chatId),
    orderBy: [desc(chatSummaries.createdAt)],
  })
  const covered = latest
    ? history.findIndex((message) => message.id === latest.upToMessageId)
    : -1
  let summary = covered >= 0 ? latest?.summary : undefined
  let kept = history.slice(covered + 1)

  const size = sizeOf(kept)
  if (threshold && size > threshold && kept.length > KEEP_RECENT + 2) {
    const cut = kept.length - KEEP_RECENT
    const older = kept.slice(0, cut)
    const { text, usage } = await generateText({
      model: languageModel(SUMMARY_MODEL),
      providerOptions: modelProviderOptions(SUMMARY_MODEL),
      system: SUMMARY_SYSTEM,
      prompt: [
        summary && `The summary so far:\n\n${summary}`,
        `The conversation since, latest last:\n\n${transcriptOf(older, names, {
          messages: older.length,
          perMessage: 3000,
        })}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    })
    const cost = await recordUsage({
      userId,
      chatId,
      kind: "summary",
      model: SUMMARY_MODEL,
      usage,
    })
    summary = text.trim()
    await db.insert(chatSummaries).values({
      chatId,
      upToMessageId: older.at(-1)!.id,
      summary,
      messageCount: covered + 1 + older.length,
      tokensBefore: size,
    })
    await recordEvent({
      chatId,
      category: "changed",
      title: `Summarized ${older.length} earlier messages`,
      detail: summary,
      cost,
    })
    kept = kept.slice(cut)
  }
  return { kept, summary }
}

// Puts the summary first, in the first user message so turns still
// alternate.
export function withSummary(
  messages: ModelMessage[],
  summary: string | undefined
): ModelMessage[] {
  if (!summary) return messages
  const note = { type: "text" as const, text: summaryNote(summary) }
  const [first, ...rest] = messages
  if (first?.role === "user") {
    const content =
      typeof first.content === "string"
        ? [{ type: "text" as const, text: first.content }]
        : first.content
    return [{ ...first, content: [note, ...content] }, ...rest]
  }
  return [{ role: "user", content: [note] }, ...messages]
}
