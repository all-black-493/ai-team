import { createAnthropic } from "@ai-sdk/anthropic"
import { prompts } from "@trigger.dev/sdk"
import { chat } from "@trigger.dev/sdk/ai"
import { isStepCount, type ModelMessage } from "ai"
import { z } from "zod"

import { getChatBot } from "@/chats/bot"
import { getStartedSandbox } from "@/lib/sandbox"
import { createBotTools } from "@/trigger/tools"

// Claude through the Neon AI Gateway (NEON_AI_GATEWAY_BASE_URL and
// NEON_AI_GATEWAY_TOKEN, from `neon env pull`), the endpoint and token
// @neon/ai-sdk-provider uses. Not that provider itself: it bundles
// @ai-sdk/anthropic 3, which drops images from tool results under AI SDK 7,
// so the bot could never see its own screenshots.
const neonClaude = createAnthropic({
  baseURL: `${process.env.NEON_AI_GATEWAY_BASE_URL}/anthropic/v1`,
  authToken: process.env.NEON_AI_GATEWAY_TOKEN,
})

// A bot's base instructions. Trigger.dev versions this on deploy, and an
// override in its dashboard changes the text without redeploying.
const botPrompt = prompts.define({
  id: "bot-chat-system",
  description: "Base instructions for a bot chatting with the user",
  variables: z.object({
    name: z.string(),
    job: z.string(),
    instructions: z.string().optional(),
  }),
  content: `You are {{name}}, a member of the user's AI Team. Your job: {{job}}.

## Your purpose

The user built their AI Team out of bots like you, each with its own name and job, and comes to this chat for help with yours. Keep to your role. If a request falls outside your job, say so briefly, then help as well as you reasonably can.

The user can change your name, job and instructions at any time. If earlier messages in this chat show different ones, they were right when they were written: go by the ones given here, and don't call the earlier ones mistakes.
{{#instructions}}

## How to do your job

The user gave you these instructions. Follow them:

{{instructions}}
{{/instructions}}

## Your environment

You have a sandbox of your own: an isolated Linux computer on Daytona, with its own filesystem and a desktop. It was created with you, no other bot shares it, and it is deleted when you are.

Your tools work in it: run commands and code, read and write files, use git and a language server, and control the desktop with the mouse and keyboard.

- On the desktop, look with view_screen before you click or type, and again afterwards to check the result. Coordinates are screen pixels.
- view_screen is for you. Use show_screen when the user wants to see the screen: it shows them the screenshot.
- Files the user attaches are saved in your sandbox, and the message says where. Open them with read_file, or view_image for a picture.
- To let the user open a web app you're running, give them a link from preview_url.

## How to reply

- Be concise and direct.
- Use Markdown where it helps, such as lists and code blocks. The chat renders it.
- Only say you've done something if you have.`,
})

// Screenshots cost the model about a thousand tokens each, and computer use
// takes many. Older ones are dropped from what it sees.
const KEEP_SCREENSHOTS = 3

// What the model sees each turn: attachments become notes about where they
// are in the sandbox (the chat only carries a sandbox: URL, never the file),
// and only the latest few screenshots from earlier turns stay as images.
function prepareContext(messages: ModelMessage[]): ModelMessage[] {
  let screenshots = 0
  return messages
    .toReversed()
    .map((message): ModelMessage => {
      if (message.role === "user" && Array.isArray(message.content)) {
        return {
          ...message,
          content: message.content.map((part) => {
            const path = part.type === "file" ? sandboxPath(part.data) : null
            if (part.type !== "file" || path === null) return part
            return {
              type: "text" as const,
              text: `[The user attached ${part.filename ?? "a file"} (${part.mediaType}). It's saved in your sandbox at ${path}]`,
            }
          }),
        }
      }
      if (message.role === "tool") {
        return {
          ...message,
          content: message.content.map((part) => {
            if (
              part.type !== "tool-result" ||
              part.output.type !== "content" ||
              !part.output.value.some((item) => item.type === "file")
            ) {
              return part
            }
            screenshots += 1
            if (screenshots <= KEEP_SCREENSHOTS) return part
            return {
              ...part,
              output: {
                type: "text" as const,
                value: "[An earlier image, no longer shown]",
              },
            }
          }),
        }
      }
      return message
    })
    .toReversed()
}

// The path in a sandbox: file reference, or null for any other file.
function sandboxPath(data: unknown) {
  const url =
    data instanceof URL
      ? data.href
      : typeof data === "string"
        ? data
        : typeof data === "object" &&
            data !== null &&
            "type" in data &&
            data.type === "url" &&
            "url" in data &&
            data.url instanceof URL
          ? data.url.href
          : null
  return url?.startsWith("sandbox:") ? url.slice("sandbox:".length) : null
}

// One durable run per chat, keyed by the chat's ID. The conversation is kept
// in the agent's default transcript storage, also keyed by chat ID, so each
// turn gets the history without the browser sending it. The chat's owner is
// checked in actions/chat.ts before a session or token is handed out.
export const botChat = chat.agent({
  id: "bot-chat",
  // Once per turn, before the model runs. Not in streamText's prepareStep:
  // a messages override there becomes the base for every later step, and
  // replacing it each step hid the bot's newest tool results, so it repeated
  // the same call until the step limit.
  prepareMessages: ({ messages }) => prepareContext(messages),
  // Declared here, not just on streamText, so toModelOutput still turns
  // screenshots into images when history is rebuilt on later turns. Made per
  // turn because they work on this chat's bot's sandbox.
  tools: ({ chatId }) => {
    // Both loaded once per turn, by the first tool that needs them.
    let bot: ReturnType<typeof getChatBot> | undefined
    let sandbox: ReturnType<typeof getStartedSandbox> | undefined
    const getBot = () => (bot ??= getChatBot(chatId))
    return createBotTools({
      getBot,
      getSandbox: () => {
        sandbox ??= getBot()
          .then(({ sandboxId }) => {
            if (!sandboxId) {
              throw new Error(
                "You don't have a sandbox: bots made before sandboxes existed don't."
              )
            }
            return getStartedSandbox(sandboxId)
          })
          .catch((error) => {
            sandbox = undefined
            throw error
          })
        return sandbox
      },
    })
  },
  // Every turn rather than once per chat: a run that picks the chat back up
  // starts without it, and edits in the bot dialog apply from the next message.
  onTurnStart: async ({ chatId }) => {
    const { name, job, instructions } = await getChatBot(chatId)
    chat.prompt.set(
      await botPrompt.resolve({
        name,
        job,
        instructions: instructions ?? undefined,
      })
    )
  },
  // The run argument's streamText applies the prompt set above. Passing
  // `system` here as well would throw.
  run: async ({ messages, tools, signal, streamText }) =>
    streamText({
      model: neonClaude("claude-sonnet-5-5"),
      messages,
      tools,
      abortSignal: signal,
      // Room for long tool loops, such as computer use.
      stopWhen: isStepCount(50),
    }),
})
