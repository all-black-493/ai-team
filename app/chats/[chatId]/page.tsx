import { notFound } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

import { getChat } from "@/chats/queries"
import { ChatComposer } from "@/components/chat-composer"
import { ChatHeader } from "@/components/chat-header"

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
    <div className="flex flex-1 flex-col">
      <ChatHeader chat={chat} />
      {/* The message list goes here. */}
      <div className="flex-1" />
      {/* DESIGN.md: the composer docks under an ~800px thread column. */}
      <div className="mx-auto w-full max-w-[800px] px-4 pb-4">
        <ChatComposer placeholder={`Message ${chat.title}…`} />
      </div>
    </div>
  )
}
