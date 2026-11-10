"use client"

import "katex/dist/katex.min.css"

import { useChat } from "@ai-sdk/react"
import type { TriggerChatTransport } from "@trigger.dev/sdk/chat"
import {
  useLoadTranscript,
  useTriggerChatTransport,
} from "@trigger.dev/sdk/chat/react"
import { upload } from "@vercel/blob/client"
import type { FileUIPart, UIMessage } from "ai"
import { FileIcon } from "lucide-react"

import {
  loadChatTranscript,
  mintChatAccessToken,
  attachChatFile,
  startChatSession,
} from "@/actions/chat"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { Message, MessageContent } from "@/components/ai-elements/message"
import { Shimmer } from "@/components/ai-elements/shimmer"
import { AssistantParts, hasVisibleParts } from "@/components/chat-activity"
import { ChatAvatar } from "@/components/chat-avatar"
import { ChatComposer, type ComposerMessage } from "@/components/chat-composer"
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import {
  attachmentPrefix,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_LABEL,
} from "@/chats/attachments"
import type { botChat } from "@/trigger/chat"

type ChatBot = { name: string; avatar: string }

type ChatThreadProps = {
  chatId: string
  bot: ChatBot
  placeholder: string
}

const attachments = {
  maxBytes: MAX_ATTACHMENT_BYTES,
  maxLabel: MAX_ATTACHMENT_LABEL,
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
  const { messages, sendMessage, status, error, regenerate, stop } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
  })
  const busy = status === "submitted" || status === "streaming"
  const last = messages.at(-1)

  // Each file goes straight from the browser to the private Blob store, then
  // into the bot's sandbox. The message carries only references to them.
  async function send({ text, files }: ComposerMessage) {
    const uploaded: FileUIPart[] = []
    try {
      for (const file of files) {
        const name = file.name.replaceAll(/[^\w.-]+/g, "_") || "file"
        const blob = await upload(`${attachmentPrefix(chatId)}${name}`, file, {
          access: "private",
          handleUploadUrl: "/api/chat-uploads",
          clientPayload: chatId,
        })
        uploaded.push(
          await attachChatFile(chatId, {
            pathname: blob.pathname,
            filename: file.name,
            mediaType: file.type,
          })
        )
      }
    } catch (error) {
      toast.add({
        title: "Couldn't attach the files",
        description: "Something went wrong. Please try again.",
        type: "error",
      })
      throw error
    }
    // Not awaited: it settles when the answer ends, and the composer is free
    // as soon as the message is on its way.
    void sendMessage(uploaded.length > 0 ? { text, files: uploaded } : { text })
  }

  // useChat's stop only ends the local stream; the agent needs telling too,
  // or it keeps going after a reload.
  function stopAnswer() {
    void stop()
    void transport.stopGeneration(chatId)
  }

  return (
    <>
      <Conversation className="min-h-0">
        <ConversationContent className="mx-auto w-full max-w-[800px] gap-6 px-4 py-6">
          {messages.map((message) => {
            if (message.role === "user") {
              return <UserMessage key={message.id} message={message} />
            }
            // An answer with nothing to show yet is covered by the thinking
            // row below.
            if (!hasVisibleParts(message)) return null
            return (
              <BotMessage key={message.id} bot={bot}>
                <AssistantParts
                  message={message}
                  streaming={busy && message.id === last?.id}
                />
              </BotMessage>
            )
          })}
          {busy && !(last?.role === "assistant" && hasVisibleParts(last)) && (
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
      {/* While the bot answers, send turns into stop. */}
      <DockedComposer
        placeholder={placeholder}
        attachments={attachments}
        onSend={busy ? undefined : send}
        onStop={busy ? stopAnswer : undefined}
      />
    </>
  )
}

// The user's turn: any attachments, then the text in a raised bubble. An
// attachment lives in the bot's sandbox, so it shows by name, not preview.
function UserMessage({ message }: { message: UIMessage }) {
  const text = textOf(message)
  const files = message.parts.filter((part) => part.type === "file")
  return (
    <Message from="user">
      {files.length > 0 && (
        <AttachmentGroup className="justify-end">
          {files.map((file, index) => (
            <Attachment key={`${message.id}-${index}`} size="sm">
              <AttachmentMedia>
                <FileIcon />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>
                  {file.filename ?? "Attachment"}
                </AttachmentTitle>
                <AttachmentDescription>{file.mediaType}</AttachmentDescription>
              </AttachmentContent>
            </Attachment>
          ))}
        </AttachmentGroup>
      )}
      {text && (
        <MessageContent className="text-base group-[.is-user]:rounded-md group-[.is-user]:bg-muted group-[.is-user]:px-3 group-[.is-user]:py-2">
          <p className="whitespace-pre-wrap">{text}</p>
        </MessageContent>
      )}
    </Message>
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
      <MessageContent className="gap-3 text-base">{children}</MessageContent>
    </Message>
  )
}
