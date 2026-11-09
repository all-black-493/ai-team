import { auth } from "@clerk/nextjs/server"
import { nanoid } from "nanoid"

import { BotDialog } from "@/components/bot-dialog"
import { ChatAvatar } from "@/components/chat-avatar"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty"

export default async function Page() {
  await auth.protect()

  // The page renders per request, so every refresh gets a new face.
  const seed = nanoid()

  return (
    <Empty>
      <EmptyHeader className="max-w-md">
        <EmptyMedia>
          <ChatAvatar seed={seed} animated="hover" className="rounded-full" />
        </EmptyMedia>
        {/* DESIGN.md hero: light serif in tertiary ink, one word marked. */}
        <h1 className="font-display text-display text-muted-foreground">
          Meet your first{" "}
          <mark className="inline-block bg-highlight px-2 leading-none text-highlight-foreground italic">
            bot
          </mark>
        </h1>
        <EmptyDescription>
          Every bot gets its own personality, memory, and face. Spin one up and
          start the conversation.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <BotDialog />
      </EmptyContent>
    </Empty>
  )
}
