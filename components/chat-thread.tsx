"use client"

import "katex/dist/katex.min.css"

import { useRef, useState } from "react"
import { useChat } from "@ai-sdk/react"
import type { TriggerChatTransport } from "@trigger.dev/sdk/chat"
import {
  useLoadTranscript,
  useTriggerChatTransport,
} from "@trigger.dev/sdk/chat/react"
import { upload } from "@vercel/blob/client"
import { readUIMessageStream, type FileUIPart, type UIMessage } from "ai"
import { FileIcon, ReplyIcon, XIcon } from "lucide-react"

import { setBotModel } from "@/actions/bot"
import {
  loadChatTranscript,
  mintChatAccessToken,
  attachChatFile,
  rateChatMessage,
  startChatSession,
} from "@/actions/chat"
import {
  Conversation,
  ConversationContent,
  ConversationDownload,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { Message, MessageContent } from "@/components/ai-elements/message"
import { Shimmer } from "@/components/ai-elements/shimmer"
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"
import { AssistantParts, hasVisibleParts } from "@/components/chat-activity"
import { ChatAvatar } from "@/components/chat-avatar"
import { ChatComposer, type ComposerMessage } from "@/components/chat-composer"
import { ChatHeader } from "@/components/chat-header"
import { MessageToolbar } from "@/components/chat-message-actions"
import { BotPicker, ModelPicker } from "@/components/chat-pickers"
import { ChatUsage } from "@/components/chat-usage"
import { GroupChatAvatar } from "@/components/group-chat-avatar"
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { Button } from "@/components/ui/button"
import { InputGroupButton } from "@/components/ui/input-group"
import { toast } from "@/components/ui/toast"
import {
  attachmentPrefix,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_LABEL,
} from "@/chats/attachments"
import { handoffOf, type Handoff } from "@/chats/handoff"
import type { ChatWithBot } from "@/chats/queries"
import type { MessageRating } from "@/db/schema"
import { cn } from "@/lib/utils"
import type { BotMessageMetadata, BotUIMessage, botChat } from "@/trigger/chat"

export type ThreadBot = {
  id: string
  name: string
  avatar: string
  model: string
}

type ChatThreadProps = {
  // Its bots are `members`, in the order they joined; a direct chat has one.
  // In a group, the user picks which bot answers each message and can reply
  // to an answer, and bots can hand a message to each other.
  chat: ChatWithBot
  // The user's saved ratings of the chat's answers, by message ID.
  ratings: Record<string, MessageRating>
}

// A message's actions show on hover or keyboard focus, and always on touch
// screens and on the latest answer.
const revealOnHover =
  "opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100"

const attachments = {
  maxBytes: MAX_ATTACHMENT_BYTES,
  maxLabel: MAX_ATTACHMENT_LABEL,
}

function textOf(message: UIMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
}

// Where a message is in the page, for a reply to jump back to it.
const anchorOf = (messageId: string) => `message-${messageId}`

function placeholderFor(bot: ThreadBot | undefined) {
  return bot ? `Message ${bot.name}…` : "This group has no bots left"
}

// A first message to send with one click, in an empty chat.
const suggestions = {
  direct: [
    "What can you help me with?",
    "Show me your screen",
    "What's set up in your sandbox?",
  ],
  group: [
    "Who in this group does what?",
    "What can you help me with?",
    "Show me your screen",
  ],
}

// The chat's header and conversation. The header is here, not on the page,
// so it can offer the conversation as a download.
export function ChatThread({ chat, ratings }: ChatThreadProps) {
  const chatId = chat.id
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
        <ChatHeader chat={chat} />
        <div className="mx-auto w-full max-w-[800px] flex-1 px-4 py-6">
          {transcript.error && (
            <p role="alert" className="text-sm text-muted-foreground">
              Couldn&apos;t load this chat.
            </p>
          )}
        </div>
        {/* Typing waits for the conversation: this composer is swapped for
            the live one when it loads, and would lose its text. */}
        <DockedComposer
          placeholder={placeholderFor(chat.members[0])}
          disabled
        />
      </>
    )
  }

  return (
    <ChatMessages
      chat={chat}
      ratings={ratings}
      transport={transport}
      initialMessages={transcript.messages as BotUIMessage[]}
    />
  )
}

// DESIGN.md "Chat conversation": an ~800px thread with the user's messages
// in raised bubbles on the right and the bot's answers full width under its
// face and mono name, over the docked composer.
function ChatMessages({
  chat,
  ratings: initialRatings,
  transport,
  initialMessages,
}: ChatThreadProps & {
  transport: TriggerChatTransport
  initialMessages: BotUIMessage[]
}) {
  const chatId = chat.id
  const group = chat.kind === "group"
  const members: ThreadBot[] = chat.members
  const {
    messages,
    setMessages,
    sendMessage,
    status,
    error,
    regenerate,
    stop,
  } = useChat<BotUIMessage>({
    id: chatId,
    messages: initialMessages,
    transport,
    // A bot that handed the message off is followed at once by the bot it
    // handed it to. Only answers that finish here: a stopped or broken one
    // doesn't hand off.
    onFinish: ({ message, isAbort, isDisconnect, isError }) => {
      const handoff = handoffOf(message)
      if (handoff && !isAbort && !isDisconnect && !isError) {
        void handOff(message.id, handoff)
      }
    },
  })
  const answering = status === "submitted" || status === "streaming"

  // A handoff being answered: the message that handed off, and how to stop
  // the answer. And whether the last one failed.
  const [handoff, setHandoff] = useState<{
    fromId: string
    controller: AbortController
  } | null>(null)
  const [handoffFailed, setHandoffFailed] = useState(false)
  const busy = answering || handoff !== null

  const last = messages.at(-1)
  // The answer coming in, once it has started: a handoff's is the one after
  // the message that handed off.
  const incoming =
    answering || (handoff && last?.id !== handoff.fromId) ? last : undefined
  const thinking =
    busy && !(incoming?.role === "assistant" && hasVisibleParts(incoming))
  // A handoff nobody has answered, such as one cut off by a reload.
  const unanswered = busy ? undefined : handoffOf(last)
  const [ratings, setRatings] = useState(initialRatings)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const membersById = new Map(members.map((member) => [member.id, member]))
  // Who wrote an answer: the bot it's stamped with, or for answers from
  // before bots were stamped, a direct chat's bot. A bot since removed from
  // the group keeps its face, under a placeholder name.
  function authorOf(message: BotUIMessage): ThreadBot | undefined {
    const botId = message.metadata?.botId
    if (!botId) return members[0]
    return (
      membersById.get(botId) ?? {
        id: botId,
        name: "Removed bot",
        avatar: botId,
        model: "",
      }
    )
  }

  // Who answers the next message. In a group the user picks, starting with
  // whoever answered last.
  const [botId, setBotId] = useState(() => {
    const lastAuthor = initialMessages.findLast(
      (message) => message.role === "assistant"
    )?.metadata?.botId
    return members.some((member) => member.id === lastAuthor)
      ? lastAuthor!
      : members[0]?.id
  })
  const bot = (botId && membersById.get(botId)) || members[0]
  // Who the answer in progress is from, for the thinking row.
  const [askedBotId, setAskedBotId] = useState(botId)
  const askedBot = (askedBotId && membersById.get(askedBotId)) || bot

  // The answer the next message replies to, in a group.
  const [replyId, setReplyId] = useState<string | null>(null)
  const replyMessage = replyId
    ? messages.find((message) => message.id === replyId)
    : undefined

  // Each bot's model, switched here at once and saved behind it. In a group
  // the picker shows the model of the bot picked to answer.
  const [models, setModels] = useState<Record<string, string>>(() =>
    Object.fromEntries(members.map((member) => [member.id, member.model]))
  )
  async function changeModel(botId: string, next: string) {
    const previous = models[botId]
    const set = (model: string) =>
      setModels((current) => ({ ...current, [botId]: model }))
    set(next)
    try {
      await setBotModel(botId, next)
    } catch {
      set(previous)
      toast.add({ title: "Couldn't switch the model", type: "error" })
    }
  }

  // Shown at once, saved behind it, and put back if saving fails.
  async function rate(messageId: string, rating: MessageRating | null) {
    const previous = ratings[messageId] ?? null
    const set = (value: MessageRating | null) =>
      setRatings((current) => {
        const next = { ...current }
        if (value) next[messageId] = value
        else delete next[messageId]
        return next
      })
    set(rating)
    try {
      await rateChatMessage(chatId, messageId, rating)
    } catch {
      set(previous)
      toast.add({ title: "Couldn't save your rating", type: "error" })
    }
  }

  // Replying to an answer asks the bot that wrote it, unless the user picks
  // another.
  function replyTo(message: BotUIMessage) {
    setReplyId(message.id)
    const author = authorOf(message)
    if (author && membersById.has(author.id)) setBotId(author.id)
    inputRef.current?.focus()
  }

  // Each file goes straight from the browser to the private Blob store, then
  // into the sandbox of the bot being asked. The message carries only
  // references to them. The bot rides along as transport metadata, which the
  // agent reads as this turn's client data.
  async function send({ text, files }: ComposerMessage) {
    if (!bot) return
    const to = bot.id
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
          await attachChatFile(chatId, to, {
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
    const metadata: BotMessageMetadata | undefined =
      group && replyMessage ? { replyTo: replyMessage.id } : undefined
    setAskedBotId(to)
    setReplyId(null)
    // Not awaited: it settles when the answer ends, and the composer is free
    // as soon as the message is on its way.
    void sendMessage(
      uploaded.length > 0
        ? { text, files: uploaded, metadata }
        : { text, metadata },
      { metadata: { botId: to } }
    )
  }

  // An answer is asked again of the bot that wrote it.
  function answerAgain(messageId: string, from: string) {
    setAskedBotId(from)
    void regenerate({ messageId, metadata: { botId: from } })
  }

  // After a failure. A message with no answer may never have reached the
  // agent, so it's sent again: with its own ID, so the agent doesn't keep it
  // twice if it did. Regenerating instead would answer the message before it.
  // A broken answer is asked again of its bot.
  function retry() {
    const latest = messages.at(-1)
    if (!latest) return
    if (latest.role === "user") {
      void sendMessage(
        {
          parts: latest.parts,
          metadata: latest.metadata,
          messageId: latest.id,
        },
        { metadata: { botId: askedBotId } }
      )
      return
    }
    const author = authorOf(latest)
    if (author) answerAgain(latest.id, author.id)
  }

  // The bot a handoff names answers it in a turn of its own, which the chat
  // asks the agent for as an action. Sent through useChat, its answer would
  // be folded into the message that handed off, as if that bot carried on,
  // so the stream is read here and the answer added as a message of its own.
  async function handOff(fromId: string, { botId }: Handoff) {
    // A bot removed from the group since can't answer.
    if (!membersById.has(botId)) return
    const controller = new AbortController()
    setAskedBotId(botId)
    // The conversation carries on with the bot it was handed to.
    setBotId(botId)
    setHandoff({ fromId, controller })
    setHandoffFailed(false)
    try {
      const stream = await transport.sendAction(
        chatId,
        { type: "handoff" },
        { abortSignal: controller.signal, metadata: { botId } }
      )
      for await (const answer of readUIMessageStream<BotUIMessage>({
        stream,
        terminateOnError: true,
      })) {
        setMessages((current) => {
          const index = current.findIndex((message) => message.id === answer.id)
          return index === -1
            ? [...current, answer]
            : current.with(index, answer)
        })
      }
    } catch {
      if (!controller.signal.aborted) setHandoffFailed(true)
    } finally {
      setHandoff(null)
    }
  }

  // useChat's stop only ends the local stream; the agent needs telling too,
  // or it keeps going after a reload. A handoff's answer stops with its
  // stream.
  function stopAnswer() {
    if (handoff) {
      handoff.controller.abort()
    } else {
      void stop()
    }
    void transport.stopGeneration(chatId)
  }

  // The conversation as Markdown, each message under its writer's name.
  function asMarkdown(message: UIMessage) {
    const author =
      message.role === "user"
        ? "You"
        : (authorOf(message as BotUIMessage)?.name ?? "Bot")
    return `**${author}:** ${textOf(message)}`
  }

  const replyAuthor = replyMessage && authorOf(replyMessage)

  const unansweredBot = unanswered && membersById.get(unanswered.botId)

  return (
    <>
      <ChatHeader
        chat={chat}
        actions={
          messages.length > 0 && (
            <ConversationDownload
              messages={messages}
              filename={`${chat.title.replaceAll(/[^\w -]+/g, "").trim() || "Chat"}.md`}
              formatMessage={asMarkdown}
              variant="ghost"
              size="icon"
              aria-label="Download the conversation"
              className="static rounded-lg dark:bg-transparent"
            />
          )
        }
      />
      <Conversation className="min-h-0">
        <ConversationContent className="mx-auto w-full max-w-[800px] gap-6 px-4 py-6">
          {messages.length === 0 && !busy && (
            <EmptyChat
              title={chat.title}
              description={
                group
                  ? "Pick who answers below. A bot can hand your message to another."
                  : (chat.bot?.job ?? "")
              }
              face={
                group ? (
                  <GroupChatAvatar members={members} className="size-12" />
                ) : (
                  <ChatAvatar
                    seed={members[0]?.avatar ?? chatId}
                    className="size-12 rounded-lg"
                  />
                )
              }
              suggestions={group ? suggestions.group : suggestions.direct}
              onSuggest={bot ? (text) => send({ text, files: [] }) : undefined}
            />
          )}
          {messages.map((message) => {
            if (message.role === "user") {
              const quotedId = message.metadata?.replyTo
              const quoted = quotedId
                ? messages.find((earlier) => earlier.id === quotedId)
                : undefined
              return (
                <UserMessage
                  key={message.id}
                  message={message}
                  quoted={
                    quoted && {
                      id: quoted.id,
                      author:
                        quoted.role === "user"
                          ? "You"
                          : (authorOf(quoted)?.name ?? "A bot"),
                      text: textOf(quoted),
                    }
                  }
                />
              )
            }
            // An answer with nothing to show yet is covered by the thinking
            // row below.
            if (!hasVisibleParts(message)) return null
            const author = authorOf(message)
            const latest = message.id === last?.id
            const streaming = busy && message.id === incoming?.id
            // A removed bot can't be asked again.
            const canAsk = author !== undefined && membersById.has(author.id)
            return (
              <BotMessage
                key={message.id}
                id={anchorOf(message.id)}
                bot={author}
              >
                <AssistantParts message={message} streaming={streaming} />
                {!streaming && (
                  <MessageToolbar
                    text={textOf(message)}
                    rating={ratings[message.id] ?? null}
                    onRate={(rating) => rate(message.id, rating)}
                    onReply={
                      group && canAsk ? () => replyTo(message) : undefined
                    }
                    // Only the latest answer: an earlier one would drop
                    // everything said after it.
                    onRegenerate={
                      latest && !busy && canAsk
                        ? () => answerAgain(message.id, author.id)
                        : undefined
                    }
                    className={cn("-ml-1.5", !latest && revealOnHover)}
                  />
                )}
              </BotMessage>
            )
          })}
          {thinking && (
            <BotMessage bot={askedBot}>
              <Shimmer>Thinking…</Shimmer>
            </BotMessage>
          )}
          {unansweredBot && !error && (
            <div
              role={handoffFailed ? "alert" : undefined}
              className="flex items-center gap-3 text-sm text-muted-foreground"
            >
              {handoffFailed
                ? "Something went wrong."
                : `${unansweredBot.name} hasn't answered yet.`}
              <Button
                variant="outline"
                size="sm"
                onClick={() => last && handOff(last.id, unanswered!)}
              >
                {handoffFailed ? "Try again" : `Ask ${unansweredBot.name}`}
              </Button>
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="flex items-center gap-3 text-sm text-muted-foreground"
            >
              Something went wrong.
              <Button variant="outline" size="sm" onClick={retry}>
                Try again
              </Button>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {/* While the bot answers, send turns into stop. */}
      <DockedComposer
        inputRef={inputRef}
        placeholder={placeholderFor(bot)}
        disabled={!bot}
        attachments={attachments}
        onSend={busy || !bot ? undefined : send}
        onStop={busy ? stopAnswer : undefined}
        header={
          replyMessage && (
            <ReplyBanner
              author={replyAuthor?.name ?? "a bot"}
              text={textOf(replyMessage)}
              onCancel={() => setReplyId(null)}
            />
          )
        }
        toolbar={
          <>
            {group && bot && (
              <BotPicker
                bots={members}
                value={bot.id}
                onValueChange={setBotId}
              />
            )}
            {bot && (
              <ModelPicker
                botName={bot.name}
                value={models[bot.id] ?? bot.model}
                onValueChange={(next) => changeModel(bot.id, next)}
              />
            )}
            <ChatUsage messages={messages} />
          </>
        }
      />
    </>
  )
}

// An empty chat: who's in it, and a few first messages to send with a click.
function EmptyChat({
  title,
  description,
  face,
  suggestions,
  onSuggest,
}: {
  title: string
  description: string
  face: React.ReactNode
  suggestions: string[]
  onSuggest?: (text: string) => void
}) {
  return (
    <ConversationEmptyState className="min-h-[50svh]">
      {face}
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {onSuggest && (
        <Suggestions className="w-full flex-wrap justify-center">
          {suggestions.map((suggestion) => (
            <Suggestion
              key={suggestion}
              suggestion={suggestion}
              onClick={onSuggest}
            />
          ))}
        </Suggestions>
      )}
    </ConversationEmptyState>
  )
}

// Above the composer's text: the answer being replied to, with a way out.
function ReplyBanner({
  author,
  text,
  onCancel,
}: {
  author: string
  text: string
  onCancel: () => void
}) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2 rounded-md bg-muted py-1 pr-1 pl-2 text-xs">
      <ReplyIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-mono text-accent-foreground">
        {author}
      </span>
      <span className="truncate text-muted-foreground">{text}</span>
      <InputGroupButton
        size="icon-xs"
        aria-label="Cancel reply"
        className="ml-auto shrink-0"
        onClick={onCancel}
      >
        <XIcon />
      </InputGroupButton>
    </div>
  )
}

// The user's turn: what it replies to, any attachments, then the text in a
// raised bubble. An attachment lives in the bot's sandbox, so it shows by
// name, not preview.
function UserMessage({
  message,
  quoted,
}: {
  message: BotUIMessage
  quoted?: { id: string; author: string; text: string }
}) {
  const text = textOf(message)
  const files = message.parts.filter((part) => part.type === "file")
  return (
    <Message from="user" id={anchorOf(message.id)}>
      {quoted && (
        <button
          type="button"
          onClick={() =>
            document
              .getElementById(anchorOf(quoted.id))
              ?.scrollIntoView({ behavior: "smooth", block: "center" })
          }
          className="ml-auto flex max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ReplyIcon className="size-3.5 shrink-0" />
          <span className="sr-only">Replying to</span>
          <span className="shrink-0 font-mono text-accent-foreground">
            {quoted.author}
          </span>
          <span className="truncate">{quoted.text}</span>
        </button>
      )}
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
      {text && (
        <MessageToolbar
          text={text}
          className={cn("-mr-1.5 justify-end", revealOnHover)}
        />
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
  id,
  children,
}: {
  bot: ThreadBot | undefined
  id?: string
  children: React.ReactNode
}) {
  return (
    <Message from="assistant" id={id}>
      {bot && (
        <div className="flex items-center gap-2">
          <ChatAvatar seed={bot.avatar} className="size-5 rounded-sm" />
          <span className="font-mono text-xs text-accent-foreground">
            {bot.name}
          </span>
        </div>
      )}
      <MessageContent className="gap-3 text-base">{children}</MessageContent>
    </Message>
  )
}
