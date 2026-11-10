import type { ReactNode } from "react"

import { BotDialog } from "@/components/bot-dialog"
import { ChatAvatar } from "@/components/chat-avatar"
import { DesktopPanelToggle } from "@/components/desktop-panel"
import { GroupChatAvatar } from "@/components/group-chat-avatar"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import type { ChatWithBot } from "@/chats/queries"

const listFormat = new Intl.ListFormat("en", {
  style: "long",
  type: "conjunction",
})

// DESIGN.md "Chat conversation": the chat's title sits top left, with no
// header bar or divider. A direct chat leads with the bot's face and adds its
// job, and the three together open the bot's edit dialog; the desktop button
// sits on the right. A group shows its bots' faces and names, and has
// neither. `actions` go on the right, before the desktop button.
export function ChatHeader({
  chat,
  actions,
}: {
  chat: ChatWithBot
  actions?: ReactNode
}) {
  const { bot } = chat

  if (!bot) {
    return (
      <header className="flex items-center gap-2 p-2">
        <h1 className="sr-only">{chat.title}</h1>
        <Item size="sm" className="w-auto min-w-0 px-2 py-1.5">
          <ItemMedia>
            <GroupChatAvatar members={chat.members} />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{chat.title}</ItemTitle>
            <ItemDescription>
              {chat.members.length > 0
                ? listFormat.format(chat.members.map((member) => member.name))
                : "No bots left in this group"}
            </ItemDescription>
          </ItemContent>
        </Item>
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </header>
    )
  }

  return (
    <header className="flex items-center gap-2 p-2">
      {/* A heading can't sit inside a button, so the page's heading is for
          screen readers and the visible title is the button's. */}
      <h1 className="sr-only">{chat.title}</h1>
      <BotDialog
        bot={bot}
        trigger={
          <Item
            size="sm"
            render={<button type="button" aria-label={`Edit ${bot.name}`} />}
            className="w-auto min-w-0 px-2 py-1.5 text-left hover:bg-muted data-popup-open:bg-muted"
          >
            <ItemMedia>
              <ChatAvatar
                seed={bot.avatar}
                animated="hover"
                className="rounded-md"
              />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{chat.title}</ItemTitle>
              <ItemDescription>{bot.job}</ItemDescription>
            </ItemContent>
          </Item>
        }
      />
      <div className="ml-auto flex items-center gap-1">
        {actions}
        {/* Shows or hides the floating desktop panel (app/chats/[chatId]). */}
        <DesktopPanelToggle />
      </div>
    </header>
  )
}
