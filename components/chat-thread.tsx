"use client"

import "katex/dist/katex.min.css"

import { useChat } from "@ai-sdk/react"
import type { TriggerChatTransport } from "@trigger.dev/sdk/chat"
import {
  useLoadTranscript,
  useTriggerChatTransport,
} from "@trigger.dev/sdk/chat/react"
import type { UIMessage } from "ai"

import {
  loadChatTranscript,
  mintChatAccessToken,
  startChatSession,
} from "@/actions/chat"
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
import type { botChat } from "@/trigger/chat"

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

export function ChatThread({ chatId, bot, placeholder }: ChatThreadProps) {
  // Talks to the bot-chat agent on Trigger.dev. Each action checks that the
  // chat belongs to the signed-in user.
  const transport = useTriggerChatTransport<typeof botChat>({
    task: "bot-chat",
    accessToken: ({ chatId }) => mintChatAccessToken(chatId),
    startSession: ({ chatId }) => startChatSession(chatId),
  })
  // The saved conversation. Passing the transport seeds its resume cursor, so
  // the live stream opens after this history instead of replaying it.
  const transcript = useLoadTranscript(chatId, loadChatTranscript, {
    transport,
  })

  // useChat mounts once the history is in, so it and the transport start
  // from the same transcript.
  if (transcript.isLoading || transcript.error) {
    return (
      <>
        <div className="mx-auto w-full max-w-[800px] flex-1 px-4 py-6">
          {transcript.error && (
            <p role="alert" className="text-sm text-muted-foreground">
              Couldn&apos;t load this chat.
            </p>
          )}
        </div>
        {/* Typing waits for the conversation: this composer is swapped for
            the live one when it loads, and would lose its text. */}
        <DockedComposer placeholder={placeholder} disabled />
      </>
    )
  }

  return (
    <ChatMessages
      chatId={chatId}
      bot={bot}
      placeholder={placeholder}
      transport={transport}
      initialMessages={transcript.messages}
    />
  )
}

// DESIGN.md "Chat conversation": an ~800px thread with the user's messages
// in raised bubbles on the right and the bot's answers full width under its
// face and mono name, over the docked composer.
function ChatMessages({
  chatId,
  bot,
  placeholder,
  transport,
  initialMessages,
}: ChatThreadProps & {
  transport: TriggerChatTransport
  initialMessages: UIMessage[]
}) {
  const { messages, sendMessage, status, error, regenerate } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
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
      {/* No sending while the bot is still answering. */}
      <DockedComposer
        placeholder={placeholder}
        onSend={busy ? undefined : (text) => sendMessage({ text })}
      />
    </>
  )
}

function DockedComposer(props: React.ComponentProps<typeof ChatComposer>) {
  return (
    <div className="mx-auto w-full max-w-[800px] px-4 pb-4">
      <ChatComposer {...props} />
    </div>
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
