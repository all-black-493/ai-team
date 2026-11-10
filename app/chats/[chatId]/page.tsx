import { notFound } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

import { getChat } from "@/chats/queries"
import { ChatHeader } from "@/components/chat-header"
import { ChatThread } from "@/components/chat-thread"

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

  return (
    // A fixed height, so the thread scrolls inside it and the composer stays
    // docked. On phones the layout's 48px top bar sits above it.
    <div className="flex h-[calc(100svh-3rem)] flex-col md:h-svh">
      <ChatHeader chat={chat} />
      <ChatThread
        // A fresh conversation for each chat.
        key={chat.id}
        chatId={chat.id}
        bot={{ name: chat.title, avatar: chat.bot?.avatar ?? chat.id }}
        placeholder={`Message ${chat.title}…`}
      />
    </div>
  )
}
