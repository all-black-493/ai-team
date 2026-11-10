"use client"

import { useState } from "react"
import {
  CheckIcon,
  CopyIcon,
  FlagIcon,
  RefreshCwIcon,
  ReplyIcon,
  Share2Icon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react"

import { MessageAction, MessageActions } from "@/components/ai-elements/message"
import { toast } from "@/components/ui/toast"
import type { MessageRating } from "@/db/schema"
import { cn } from "@/lib/utils"

type MessageToolbarProps = {
  text: string
  // Rating and regenerating are for the bot's answers only.
  rating?: MessageRating | null
  onRate?: (rating: MessageRating | null) => void
  onRegenerate?: () => void
  // Replying and flagging are for answers in group chats.
  onReply?: () => void
  onFlag?: () => void
  className?: string
}

// What you can do with a message: copy it, share it, rate an answer, reply
// to it, flag it, or have the bot answer again.
export function MessageToolbar({
  text,
  rating,
  onRate,
  onRegenerate,
  onReply,
  onFlag,
  className,
}: MessageToolbarProps) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.add({ title: "Couldn't copy the message", type: "error" })
    }
  }

  // The device's share sheet where there is one; elsewhere, most desktop
  // browsers, the text is copied to paste wherever it's going.
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ text })
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return
        toast.add({ title: "Couldn't share the message", type: "error" })
      }
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      toast.add({
        title: "Copied to share",
        description: "Paste it wherever you'd like to share it.",
        type: "success",
      })
    } catch {
      toast.add({ title: "Couldn't share the message", type: "error" })
    }
  }

  return (
    <MessageActions className={className}>
      {onReply && (
        <MessageAction tooltip="Reply" size="icon-xs" onClick={onReply}>
          <ReplyIcon />
        </MessageAction>
      )}
      <MessageAction
        tooltip={copied ? "Copied" : "Copy"}
        size="icon-xs"
        onClick={copy}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </MessageAction>
      {onRate && (
        <>
          <MessageAction
            tooltip="Good response"
            size="icon-xs"
            aria-pressed={rating === "up"}
            onClick={() => onRate(rating === "up" ? null : "up")}
          >
            <ThumbsUpIcon className={cn(rating === "up" && "fill-current")} />
          </MessageAction>
          <MessageAction
            tooltip="Bad response"
            size="icon-xs"
            aria-pressed={rating === "down"}
            onClick={() => onRate(rating === "down" ? null : "down")}
          >
            <ThumbsDownIcon
              className={cn(rating === "down" && "fill-current")}
            />
          </MessageAction>
        </>
      )}
      <MessageAction tooltip="Share" size="icon-xs" onClick={share}>
        <Share2Icon />
      </MessageAction>
      {onFlag && (
        <MessageAction tooltip="Flag" size="icon-xs" onClick={onFlag}>
          <FlagIcon />
        </MessageAction>
      )}
      {onRegenerate && (
        <MessageAction
          tooltip="Regenerate"
          size="icon-xs"
          onClick={onRegenerate}
        >
          <RefreshCwIcon />
        </MessageAction>
      )}
    </MessageActions>
  )
}
