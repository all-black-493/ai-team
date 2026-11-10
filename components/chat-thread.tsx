"use client"

import "katex/dist/katex.min.css"

import { useChat } from "@ai-sdk/react"
import type { UIMessage } from "ai"

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import { Shimmer } from "@/components/ai-elements/shimmer"
import { ChatAvatar } from "@/components/chat-avatar"
import { ChatComposer } from "@/components/chat-composer"
import { Button } from "@/components/ui/button"

type ChatBot = { name: string; avatar: string }

type ChatThreadProps = {
  chatId: string
  bot: ChatBot
  placeholder: string
}

function textOf(message: UIMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
}

// DESIGN.md "Chat conversation": an ~800px thread with the user's messages
// in raised bubbles on the right and the bot's answers full width under its
// face and mono name, over the docked composer.
export function ChatThread({ chatId, bot, placeholder }: ChatThreadProps) {
  // Posts to /api/chat with this chat's ID. Messages live only here, so a
  // reload starts the conversation over.
  const { messages, sendMessage, status, error, regenerate } = useChat({
    id: chatId,
  })
  const busy = status === "submitted" || status === "streaming"

  // Until the bot's first words arrive, show it thinking.
  const last = messages.at(-1)
  const answering = busy && last?.role === "assistant" && textOf(last) !== ""

  return (
    <>
      <Conversation className="min-h-0">
        <ConversationContent className="mx-auto w-full max-w-[800px] gap-6 px-4 py-6">
          {messages.map((message) => {
            const text = textOf(message)
            if (message.role === "user") {
              return (
                <Message key={message.id} from="user">
                  <MessageContent className="text-base group-[.is-user]:rounded-md group-[.is-user]:bg-muted group-[.is-user]:px-3 group-[.is-user]:py-2">
                    <p className="whitespace-pre-wrap">{text}</p>
                  </MessageContent>
                </Message>
              )
            }
            // An answer with no text yet is covered by the thinking row.
            if (text === "") return null
            return (
              <BotMessage key={message.id} bot={bot}>
                <MessageResponse
                  isAnimating={answering && message.id === last?.id}
                >
                  {text}
                </MessageResponse>
              </BotMessage>
            )
          })}
          {busy && !answering && (
            <BotMessage bot={bot}>
              <Shimmer>Thinking…</Shimmer>
            </BotMessage>
          )}
          {error && (
            <div
              role="alert"
              className="flex items-center gap-3 text-sm text-muted-foreground"
            >
              Something went wrong.
              <Button variant="outline" size="sm" onClick={() => regenerate()}>
                Try again
              </Button>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="mx-auto w-full max-w-[800px] px-4 pb-4">
        {/* No sending while the bot is still answering. */}
        <ChatComposer
          placeholder={placeholder}
          onSend={busy ? undefined : (text) => sendMessage({ text })}
        />
      </div>
    </>
  )
}

// In place of Arena's "Assistant A" label: the bot's face and its name in
// the mono face, then the answer at 16/24.
function BotMessage({
  bot,
  children,
}: {
  bot: ChatBot
  children: React.ReactNode
}) {
  return (
    <Message from="assistant">
      <div className="flex items-center gap-2">
        <ChatAvatar seed={bot.avatar} className="size-5 rounded-sm" />
        <span className="font-mono text-xs text-accent-foreground">
          {bot.name}
        </span>
      </div>
      <MessageContent className="text-base">{children}</MessageContent>
    </Message>
  )
}
