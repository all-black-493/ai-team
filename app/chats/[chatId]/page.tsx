import { notFound } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

import {
  getChat,
  getChatBudget,
  getChatRatings,
  getChatTimeline,
  getGroupOverview,
} from "@/chats/queries"
import { ChatThread } from "@/components/chat-thread"
import { DesktopPanel, DesktopPanelProvider } from "@/components/desktop-panel"
import { getUserBots } from "@/queries/bot"
import { getSettings } from "@/queries/settings"

export default async function Page({
  params,
}: {
  params: Promise<{ chatId: string }>
}) {
  await auth.protect()

  const { chatId } = await params
  const chat = await getChat(chatId)
  // Missing, or another user's: both look the same.
  if (!chat) notFound()
  const ratings = await getChatRatings(chat.id)
  // A group's settings pick from the user's bots. Not awaited: only the
  // dialog reads it, so the page doesn't wait for it.
  const bots = chat.kind === "group" ? getUserBots() : undefined
  // How a group governs itself: roles, standing, flags, tasks.
  const [overview, budget] = await Promise.all([
    getGroupOverview(chat.id),
    getChatBudget(chat.id),
  ])
  // Read only once the timeline or the limits are opened.
  const timeline = getChatTimeline(chat.id)
  const settings = getSettings()

  const content = (
    // A fixed height, so the thread scrolls inside it and the composer stays
    // docked. On phones the layout's 48px top bar sits above it.
    // ChatThread renders the header too, to put the conversation's download
    // in it.
    <div className="flex h-[calc(100svh-3rem)] flex-col md:h-svh">
      <ChatThread
        // A fresh conversation for each chat.
        key={chat.id}
        chat={chat}
        bots={bots}
        overview={overview}
        ratings={ratings}
        budget={budget}
        timeline={timeline}
        settings={settings}
      />
    </div>
  )

  // Each bot with a sandbox has a desktop the panel can show; the panel
  // floats over the header and the thread, and opens when a bot uses it.
  // Keyed by chat, so another chat starts with its own.
  const desktops = chat.members
    .filter((member) => member.hasSandbox)
    .map(({ id, name }) => ({ id, name }))
  if (desktops.length === 0) return content

  return (
    <DesktopPanelProvider key={chat.id} chatId={chat.id} bots={desktops}>
      {content}
      <DesktopPanel />
    </DesktopPanelProvider>
  )
}
