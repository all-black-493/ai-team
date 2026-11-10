import { MonitorIcon } from "lucide-react"

import { BotDialog } from "@/components/bot-dialog"
import { ChatAvatar } from "@/components/chat-avatar"
import { Button } from "@/components/ui/button"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import type { ChatWithBot } from "@/chats/queries"

// DESIGN.md "Chat conversation": the chat's title sits top left, with no
// header bar or divider. Ours leads with the bot's face and adds its job,
// and the three together open the bot's edit dialog.
export function ChatHeader({ chat }: { chat: ChatWithBot }) {
  const { bot } = chat

  const summary = (
    <>
      <ItemMedia>
        <ChatAvatar
          seed={bot?.avatar ?? chat.id}
          animated="hover"
          className="rounded-md"
        />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{chat.title}</ItemTitle>
        {bot?.job && <ItemDescription>{bot.job}</ItemDescription>}
      </ItemContent>
    </>
  )

  return (
    <header className="flex items-center gap-2 p-2">
      {/* A heading can't sit inside a button, so the page's heading is for
          screen readers and the visible title is the button's. */}
      <h1 className="sr-only">{chat.title}</h1>
      {bot ? (
        <BotDialog
          bot={bot}
          trigger={
            <Item
              size="sm"
              render={<button type="button" aria-label={`Edit ${bot.name}`} />}
              className="w-auto min-w-0 px-2 py-1.5 text-left hover:bg-muted data-popup-open:bg-muted"
            >
              {summary}
            </Item>
          }
        />
      ) : (
        <Item size="sm" className="w-auto min-w-0 px-2 py-1.5">
          {summary}
        </Item>
      )}
      {/* Placeholder: does nothing yet. */}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Desktop"
        className="ml-auto"
      >
        <MonitorIcon />
      </Button>
    </header>
  )
}
