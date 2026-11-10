import { notFound } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

import { getChat, getChatRatings } from "@/chats/queries"
import { ChatThread } from "@/components/chat-thread"
import { DesktopPanel, DesktopPanelProvider } from "@/components/desktop-panel"

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
        ratings={ratings}
      />
    </div>
  )

  // Group chats have no desktop yet.
  if (!chat.bot) return content

  return (
    // The desktop panel floats over the header and the thread, and the
    // header's desktop button toggles it, so the provider holds all three.
    // Keyed by chat, so another chat gets its own bot's desktop.
    <DesktopPanelProvider key={chat.id} chatId={chat.id}>
      {content}
      <DesktopPanel />
    </DesktopPanelProvider>
  )
}
