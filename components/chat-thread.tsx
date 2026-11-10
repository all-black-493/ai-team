"use client"

import "katex/dist/katex.min.css"

import { useEffect, useEffectEvent, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useChat } from "@ai-sdk/react"
import type { TriggerChatTransport } from "@trigger.dev/sdk/chat"
import {
  useLoadTranscript,
  useSubAgentMessages,
  useTriggerChatTransport,
} from "@trigger.dev/sdk/chat/react"
import { upload } from "@vercel/blob/client"
import {
  readUIMessageStream,
  type FileUIPart,
  type UIMessage,
  type UIMessageChunk,
} from "ai"
import { FileIcon, FlagIcon, PlaneIcon, ReplyIcon, XIcon } from "lucide-react"

import { setBotModel } from "@/actions/bot"
import { setAutopilot } from "@/actions/group"
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
import {
  AssistantParts,
  ChatActivityProvider,
  hasVisibleParts,
} from "@/components/chat-activity"
import { ChatAvatar } from "@/components/chat-avatar"
import { ChatComposer, type ComposerMessage } from "@/components/chat-composer"
import { ChatHeader } from "@/components/chat-header"
import {
  FlagMessageDialog,
  type FlaggedMessage,
} from "@/components/flag-message-dialog"
import { RoleBadge, SuspendedBadge } from "@/components/role-badge"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { InputGroupButton } from "@/components/ui/input-group"
import { toast } from "@/components/ui/toast"
import { Toggle } from "@/components/ui/toggle"
import {
  attachmentPrefix,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_LABEL,
} from "@/chats/attachments"
import { changedGroup, needsFollowUp } from "@/chats/group"
import { handoffOf } from "@/chats/handoff"
import type { ChatWithBot, GroupOverview } from "@/chats/queries"
import type { MessageRating } from "@/db/schema"
import type { UserBot } from "@/queries/bot"
import {
  FLAG_STATUS_LABELS,
  MAX_AUTOPILOT_TURNS,
  MODERATION_ACTIONS,
  type RoleKind,
} from "@/lib/governance"
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
  // The user's bots, for a group's settings to pick from.
  bots?: Promise<UserBot[]>
  // How a group governs itself: its bots' roles and standing, flags and the
  // moderation record. Null for a direct chat.
  overview?: GroupOverview | null
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

// The most turns the chat runs on its own in a row, such as a flag's
// response and review: a guard against bots handing a message round. On
// autopilot, it's MAX_AUTOPILOT_TURNS.
const MAX_AUTOMATIC_TURNS = 4

// Passes a turn's stream through, handing the work of bots it sets going
// (data-subagent chunks) to `onData` on the way, as useChat does for its own.
function forwardWork(onData: (part: { type: string; data?: unknown }) => void) {
  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      if (chunk.type.startsWith("data-")) {
        onData(chunk as { type: string; data?: unknown })
      }
      controller.enqueue(chunk)
    },
  })
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
    "Split up a plan for my week between you",
    "Vote on the best name for my side project",
  ],
}

// The chat's header and conversation. The header is here, not on the page,
// so it can offer the conversation as a download.
export function ChatThread({ chat, bots, overview, ratings }: ChatThreadProps) {
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
        <ChatHeader chat={chat} bots={bots} overview={overview} />
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
      bots={bots}
      overview={overview}
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
  bots,
  overview,
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
  const router = useRouter()
  // The live answers of bots at work in a consult or delegate call, from
  // the chunks forwarded inside the calling bot's answer.
  const subAgents = useSubAgentMessages<BotUIMessage>()
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
    onData: subAgents.onData,
    // An answer that leaves another bot's turn due, such as a handoff or a
    // flag, is followed at once by that turn, and on autopilot every answer
    // is followed by the next. Only answers that finish here: a stopped or
    // broken one doesn't carry on.
    onFinish: ({ message, isAbort, isDisconnect, isError }) => {
      // A bot changed the group: load it again, for the header, the badges,
      // the bot picker and the sidebar.
      if (changedGroup(message)) router.refresh()
      if (
        (needsFollowUp(message) || autopilotRef.current) &&
        !isAbort &&
        !isDisconnect &&
        !isError
      ) {
        void carryOn(message.id, handoffOf(message)?.botId)
      }
    },
  })
  const answering = status === "submitted" || status === "streaming"

  // Turns the chat runs on its own, in progress: the last message before
  // the one coming in, and how to stop it. And whether the last run failed.
  const [auto, setAuto] = useState<{
    fromId: string | undefined
    controller: AbortController
  } | null>(null)
  const [autoFailed, setAutoFailed] = useState(false)
  const busy = answering || auto !== null

  // On autopilot, the group's bots carry on after every answer, a bot the
  // agent's director picks at a time, until it picks nobody (`idle`) or
  // they've run MAX_AUTOPILOT_TURNS in a row (`limit`). The ref is what the
  // running loop reads, so switching off stops it after the turn in hand.
  const [autopilot, setAutopilotOn] = useState(overview?.autopilot ?? false)
  const autopilotRef = useRef(autopilot)
  const [autopilotStop, setAutopilotStop] = useState<"idle" | "limit" | null>(
    null
  )
  // A message the user sent while turns ran on their own: it goes once the
  // turn in hand ends.
  const queuedRef = useRef<(() => void) | null>(null)
  const [queued, setQueued] = useState<string | null>(null)

  const last = messages.at(-1)
  // The answer coming in, once it has started: an automatic turn's is the
  // one after the message it follows.
  const incoming =
    answering || (auto && last?.id !== auto.fromId) ? last : undefined
  const thinking =
    busy && !(incoming?.role === "assistant" && hasVisibleParts(incoming))

  // Each bot's role and standing in a group, and the latest flag on each
  // message, with what was decided.
  const standing = new Map(
    overview?.members.map((member) => [member.id, member]) ?? []
  )
  const flagOf = (messageId: string) =>
    overview?.flags.findLast((flag) => flag.messageId === messageId)
  const openFlag = overview?.flags.find(
    (flag) =>
      flag.status === "awaiting_response" || flag.status === "awaiting_review"
  )
  // A turn still due that nothing is running, such as one cut off by a
  // reload: an unanswered handoff, or a flag waiting for its bot or a
  // moderator.
  const due = busy ? undefined : (handoffOf(last) ?? openFlag)
  const [flagging, setFlagging] = useState<FlaggedMessage | null>(null)
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
  // Who the answer in progress is from, for the thinking row: null while an
  // automatic turn hasn't said yet.
  const [askedBotId, setAskedBotId] = useState<string | null | undefined>(botId)
  const askedBot =
    askedBotId === null
      ? undefined
      : (askedBotId && membersById.get(askedBotId)) || bot

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

  // Runs the turns the chat runs on its own, one after another, until none
  // is due: a handoff's answer, a flagged bot's response, a moderator's
  // review, and on autopilot, the next bot's turn. Each is asked of the
  // agent as an action, which runs whichever turn is due. Sent through
  // useChat, its answer would be folded into the message before it, as if
  // that bot carried on, so the stream is read here and the answer added as
  // a message of its own; forwarded work of bots it sets to work goes to
  // subAgents on the way. `botId`, when known, is the first turn's bot. A
  // message the user sent meanwhile goes once the loop ends.
  async function carryOn(fromId: string | undefined, botId?: string) {
    const controller = new AbortController()
    setAskedBotId(botId && membersById.has(botId) ? botId : null)
    // After a handoff, the conversation carries on with that bot.
    if (botId && membersById.has(botId)) setBotId(botId)
    setAuto({ fromId, controller })
    setAutoFailed(false)
    setAutopilotStop(null)
    let stopped: "idle" | "limit" | null = null
    try {
      for (let turn = 0; ; turn++) {
        if (
          turn >=
          (autopilotRef.current ? MAX_AUTOPILOT_TURNS : MAX_AUTOMATIC_TURNS)
        ) {
          if (autopilotRef.current) stopped = "limit"
          break
        }
        const stream = await transport.sendAction(
          chatId,
          { type: "continue" },
          { abortSignal: controller.signal, metadata: { auto: true } }
        )
        let answered: BotUIMessage | undefined
        for await (const answer of readUIMessageStream<BotUIMessage>({
          stream: stream.pipeThrough(forwardWork(subAgents.onData)),
          terminateOnError: true,
        })) {
          answered = answer
          if (answer.metadata?.botId) setAskedBotId(answer.metadata.botId)
          setMessages((current) => {
            const index = current.findIndex(
              (message) => message.id === answer.id
            )
            return index === -1
              ? [...current, answer]
              : current.with(index, answer)
          })
        }
        // No turn was due, and on autopilot, nobody needs to speak.
        if (!answered) {
          if (autopilotRef.current) stopped = "idle"
          break
        }
        const answer = answered
        setAuto((current) => current && { ...current, fromId: answer.id })
        setAskedBotId(null)
        if (changedGroup(answer)) router.refresh()
        if (queuedRef.current) break
        if (!needsFollowUp(answer) && !autopilotRef.current) break
      }
    } catch {
      if (!controller.signal.aborted) setAutoFailed(true)
    } finally {
      setAuto(null)
      setAutopilotStop(stopped)
      // Flags, roles or standing may have changed along the way.
      router.refresh()
      const next = queuedRef.current
      queuedRef.current = null
      setQueued(null)
      next?.()
    }
  }

  // Switches autopilot, saved before the bots start, as the agent reads it.
  // On, they start at once unless a turn is running: it carries on after.
  async function switchAutopilot(on: boolean) {
    autopilotRef.current = on
    setAutopilotOn(on)
    setAutopilotStop(null)
    try {
      await setAutopilot(chatId, on)
    } catch {
      autopilotRef.current = !on
      setAutopilotOn(!on)
      toast.add({
        title: on
          ? "Couldn't turn on autopilot"
          : "Couldn't turn off autopilot",
        type: "error",
      })
      return
    }
    if (on && !busy) void carryOn(messages.at(-1)?.id)
  }

  // A group left on autopilot picks up where it was when the chat opens.
  // Once: in development, effects run twice on mount.
  const resumed = useRef(false)
  const resumeAutopilot = useEffectEvent(() => {
    if (resumed.current) return
    resumed.current = true
    if (group && autopilotRef.current && !busy) {
      void carryOn(messages.at(-1)?.id)
    }
  })
  useEffect(() => {
    resumeAutopilot()
  }, [])

  // While turns run on their own, a message waits for the one in hand.
  function queue(message: ComposerMessage) {
    queuedRef.current = () => void send(message)
    setQueued(message.text || "Your attachments")
  }

  // useChat's stop only ends the local stream; the agent needs telling too,
  // or it keeps going after a reload. An automatic turn stops with its
  // stream. Stopping also takes the group off autopilot.
  function stopAnswer() {
    if (autopilotRef.current) void switchAutopilot(false)
    if (auto) {
      auto.controller.abort()
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

  // What the due turn is waiting for, in words.
  const dueText = !due
    ? undefined
    : "status" in due
      ? due.status === "awaiting_response"
        ? `${membersById.get(due.botId)?.name ?? "A bot"} hasn't answered its flag yet.`
        : "A moderator hasn't reviewed a flag yet."
      : `${membersById.get(due.botId)?.name ?? "A bot"} hasn't answered yet.`

  return (
    <>
      <ChatHeader
        chat={chat}
        bots={bots}
        overview={overview}
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
      <ChatActivityProvider bots={members} work={subAgents.get}>
        <Conversation className="min-h-0">
          <ConversationContent className="mx-auto w-full max-w-[800px] gap-6 px-4 py-6">
            {messages.length === 0 && !busy && (
              <EmptyChat
                title={chat.title}
                description={
                  group
                    ? "Pick who answers below, or turn on autopilot and let the bots work it out together."
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
                onSuggest={
                  bot ? (text) => send({ text, files: [] }) : undefined
                }
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
              const flag = flagOf(message.id)
              const flagOpen =
                flag?.status === "awaiting_response" ||
                flag?.status === "awaiting_review"
              return (
                <BotMessage
                  key={message.id}
                  id={anchorOf(message.id)}
                  bot={author}
                  standing={author && standing.get(author.id)}
                  flag={
                    flag && {
                      label:
                        flag.status === "resolved"
                          ? (overview?.actions.find(
                              (action) => action.flagId === flag.id
                            )?.action ?? "resolved")
                          : flag.status,
                    }
                  }
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
                      // A bot's answer in a group, once, while it's in it.
                      onFlag={
                        group && canAsk && !flagOpen && !busy
                          ? () =>
                              setFlagging({
                                id: message.id,
                                botId: author.id,
                                botName: author.name,
                                text: textOf(message),
                              })
                          : undefined
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
            {(due || autoFailed) && !busy && !error && (
              <div
                role={autoFailed ? "alert" : undefined}
                className="flex items-center gap-3 text-sm text-muted-foreground"
              >
                {autoFailed ? "Something went wrong." : dueText}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => carryOn(last?.id)}
                >
                  {autoFailed ? "Try again" : "Carry on"}
                </Button>
              </div>
            )}
            {autopilot && autopilotStop && !busy && !error && !autoFailed && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                {autopilotStop === "limit"
                  ? `Autopilot paused after ${MAX_AUTOPILOT_TURNS} turns in a row.`
                  : "On autopilot. The bots have nothing to do right now."}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => carryOn(last?.id)}
                >
                  {autopilotStop === "limit" ? "Keep going" : "Check again"}
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
      </ChatActivityProvider>
      {/* While the bot answers, send turns into stop. */}
      <DockedComposer
        inputRef={inputRef}
        placeholder={placeholderFor(bot)}
        disabled={!bot}
        attachments={attachments}
        // While turns run on their own, a message waits for the one in
        // hand; while the user's own is answered, there's only stop.
        onSend={!bot ? undefined : !busy ? send : auto ? queue : undefined}
        onStop={busy ? stopAnswer : undefined}
        header={
          queued ? (
            <ReplyBanner
              label="Sends next"
              author="You"
              text={queued}
              onCancel={() => {
                queuedRef.current = null
                setQueued(null)
              }}
            />
          ) : (
            replyMessage && (
              <ReplyBanner
                label="Replying to"
                author={replyAuthor?.name ?? "a bot"}
                text={textOf(replyMessage)}
                onCancel={() => setReplyId(null)}
              />
            )
          )
        }
        toolbar={
          <>
            {group && bot && (
              <BotPicker
                bots={members.map((member) => ({
                  ...member,
                  role: standing.get(member.id)?.role,
                  suspended: Boolean(standing.get(member.id)?.suspendedUntil),
                }))}
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
            {group && bot && (
              <Toggle
                size="sm"
                pressed={autopilot}
                onPressedChange={switchAutopilot}
                aria-label="Autopilot"
                title={
                  autopilot
                    ? "On autopilot: the bots carry on without you"
                    : "Let the bots carry on without you"
                }
              >
                <PlaneIcon data-icon="inline-start" />
                <span className="hidden sm:inline">Autopilot</span>
              </Toggle>
            )}
            <ChatUsage messages={messages} />
          </>
        }
      />
      <FlagMessageDialog
        chatId={chatId}
        message={flagging}
        onOpenChange={(open) => !open && setFlagging(null)}
        onFlagged={(flag) => carryOn(last?.id, flag.botId)}
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

// Above the composer's text: the answer being replied to, or the user's
// message waiting to send, with a way out.
function ReplyBanner({
  label,
  author,
  text,
  onCancel,
}: {
  label: string
  author: string
  text: string
  onCancel: () => void
}) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2 rounded-md bg-muted py-1 pr-1 pl-2 text-xs">
      <ReplyIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="sr-only">{label}</span>
      <span className="shrink-0 font-mono text-accent-foreground">
        {author}
      </span>
      <span className="truncate text-muted-foreground">{text}</span>
      <InputGroupButton
        size="icon-xs"
        aria-label={`Cancel: ${label.toLowerCase()}`}
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
// the mono face, then the answer at 16/24. In a group, small badges beside
// the name show the bot's role, a suspension, and a flag on this message
// with where it stands or what was decided.
function BotMessage({
  bot,
  id,
  standing,
  flag,
  children,
}: {
  bot: ThreadBot | undefined
  id?: string
  standing?: {
    role: { kind: RoleKind; name: string }
    suspendedUntil: Date | null
  }
  flag?: { label: string }
  children: React.ReactNode
}) {
  return (
    <Message from="assistant" id={id}>
      {bot && (
        <div className="flex flex-wrap items-center gap-2">
          <ChatAvatar seed={bot.avatar} className="size-5 rounded-sm" />
          <span className="font-mono text-xs text-accent-foreground">
            {bot.name}
          </span>
          {standing && (
            <RoleBadge kind={standing.role.kind} name={standing.role.name} />
          )}
          {standing?.suspendedUntil && <SuspendedBadge />}
          {flag && (
            <Badge
              variant="outline"
              className="h-4 gap-1 px-1.5 text-[10px] leading-none"
            >
              <FlagIcon className="size-2.5!" />
              {flagLabel(flag.label)}
            </Badge>
          )}
        </div>
      )}
      <MessageContent className="gap-3 text-base">{children}</MessageContent>
    </Message>
  )
}

// A flag's badge: where it stands, or the action it ended in.
function flagLabel(label: string) {
  if (label in FLAG_STATUS_LABELS) {
    return `Flagged · ${FLAG_STATUS_LABELS[label as keyof typeof FLAG_STATUS_LABELS].toLowerCase()}`
  }
  if (label in MODERATION_ACTIONS) {
    return `Flagged · ${MODERATION_ACTIONS[label as keyof typeof MODERATION_ACTIONS].toLowerCase()}`
  }
  return "Flagged"
}
