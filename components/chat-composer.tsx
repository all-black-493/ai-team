"use client"

import { useState } from "react"
import { ArrowRightIcon } from "lucide-react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"

type ChatComposerProps = {
  placeholder?: string
  // Without it, sending is off: the send button stays disabled.
  onSend?: (message: string) => void
}

// DESIGN.md's composer, measured on arena.ai: a surface fill and hairline
// border that darkens on focus (no ring), a 14px radius and 8px padding;
// 16/24 text with 12px padding, at least 80px and at most 40vh tall; and a
// 32px outlined send button with a 4px radius, at half opacity until there's
// text. Enter sends, Shift+Enter adds a line.
export function ChatComposer({
  placeholder = "Ask anything…",
  onSend,
}: ChatComposerProps) {
  const [message, setMessage] = useState("")
  const canSend = onSend !== undefined && message.trim().length > 0

  function send() {
    if (!canSend) return
    onSend(message.trim())
    setMessage("")
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
    >
      {/* InputGroup dims itself when anything inside is disabled; the
          has-disabled overrides keep the disabled send button from fading
          the whole composer. */}
      <InputGroup className="gap-2 rounded-[14px] border-border bg-card p-2 has-disabled:bg-card has-disabled:opacity-100 has-[[data-slot=input-group-control]:focus-visible]:border-border-medium has-[[data-slot=input-group-control]:focus-visible]:ring-0 dark:bg-card dark:has-disabled:bg-card">
        <InputGroupTextarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
          placeholder={placeholder}
          aria-label="Message"
          className="max-h-[40vh] min-h-20 p-3 text-base md:text-base"
        />
        <InputGroupAddon align="block-end" className="p-0">
          <InputGroupButton
            type="submit"
            variant="outline"
            size="icon-sm"
            disabled={!canSend}
            aria-label="Send message"
            className="ml-auto rounded-[4px] bg-transparent"
          >
            <ArrowRightIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
