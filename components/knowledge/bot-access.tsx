"use client"

import { useOptimistic, useTransition } from "react"

import { setCollectionBot } from "@/actions/knowledge"
import { ChatAvatar } from "@/components/chat-avatar"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"

type AccessBot = {
  id: string
  name: string
  avatar: string
  job: string
  granted?: boolean
}

function BotRow({
  collectionId,
  bot,
  editable,
}: {
  collectionId: string
  bot: AccessBot
  editable: boolean
}) {
  const [granted, setGranted] = useOptimistic(bot.granted ?? true)
  const [, startTransition] = useTransition()
  return (
    <Item variant="outline" size="sm">
      <ItemMedia>
        <ChatAvatar seed={bot.avatar} className="size-8 rounded-md" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{bot.name}</ItemTitle>
        <ItemDescription>{bot.job}</ItemDescription>
      </ItemContent>
      {editable && (
        <ItemActions>
          <Switch
            checked={granted}
            aria-label={`${bot.name} can read this collection`}
            onCheckedChange={(checked) =>
              startTransition(async () => {
                setGranted(checked)
                try {
                  await setCollectionBot(collectionId, bot.id, checked)
                } catch {
                  toast.add({
                    title: "Couldn't change access",
                    description: "Something went wrong. Please try again.",
                    type: "error",
                  })
                }
              })
            }
          />
        </ItemActions>
      )}
    </Item>
  )
}

export function BotAccess({
  collectionId,
  bots,
  editable,
}: {
  collectionId: string
  bots: AccessBot[]
  editable: boolean
}) {
  return (
    <ItemGroup className="gap-2">
      {bots.map((bot) => (
        <BotRow
          key={bot.id}
          collectionId={collectionId}
          bot={bot}
          editable={editable}
        />
      ))}
    </ItemGroup>
  )
}
