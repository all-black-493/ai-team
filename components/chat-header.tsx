import type { ReactNode } from "react"

import { BotDialog } from "@/components/bot-dialog"
import { ChatAvatar } from "@/components/chat-avatar"
import { DesktopPanelToggle } from "@/components/desktop-panel"
import { GroupChatAvatar } from "@/components/group-chat-avatar"
import { GroupChatDialog } from "@/components/group-chat-dialog"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import type { ChatWithBot, GroupOverview } from "@/chats/queries"
import type { UserBot } from "@/queries/bot"

const listFormat = new Intl.ListFormat("en", {
  style: "long",
  type: "conjunction",
})

// DESIGN.md "Chat conversation": the chat's title sits top left, with no
// header bar or divider. A direct chat leads with the bot's face and adds its
// job, and the three together open the bot's edit dialog; the desktop button
// sits on the right. A group shows its bots' faces and names, which open the
// group's settings; it has no desktop. `actions` go on the right, before the
// desktop button. `bots` are the user's, for a group's settings to pick from.
export function ChatHeader({
  chat,
  bots,
  overview,
  actions,
}: {
  chat: ChatWithBot
  bots?: Promise<UserBot[]>
  overview?: GroupOverview | null
  actions?: ReactNode
}) {
  const { bot } = chat

  if (!bot) {
    const summary = (
      <>
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
      </>
    )
    return (
      <header className="flex items-center gap-2 p-2">
        {/* A heading can't sit inside a button, so the page's heading is
            for screen readers and the visible title is the button's. */}
        <h1 className="sr-only">{chat.title}</h1>
        {bots && overview ? (
          <GroupChatDialog
            bots={bots}
            overview={overview}
            group={{
              id: chat.id,
              name: chat.title,
              members: chat.members.map(
                ({ id, name, avatar, role, groupOwned }) => ({
                  id,
                  name,
                  avatar,
                  roleId: role?.id ?? null,
                  groupOwned,
                })
              ),
            }}
            trigger={
              <Item
                size="sm"
                render={
                  <button type="button" aria-label={`Edit ${chat.title}`} />
                }
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
