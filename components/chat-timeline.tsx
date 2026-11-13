"use client"

import { Suspense, use, useState } from "react"
import { format, isToday } from "date-fns"
import {
  CoinsIcon,
  GavelIcon,
  HistoryIcon,
  PencilIcon,
  UsersIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"

import { ChatAvatar } from "@/components/chat-avatar"
import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from "@/components/reui/timeline"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ChatBudget } from "@/chats/queries"
import type { ChatEvent, EventCategory } from "@/db/schema"
import { describeScope, formatCost } from "@/lib/budget"

type TimelineBot = { id: string; name: string; avatar: string }

const CATEGORIES: Record<EventCategory, { label: string; icon: LucideIcon }> = {
  did: { label: "Did", icon: WrenchIcon },
  delegated: { label: "Delegated", icon: UsersIcon },
  changed: { label: "Changed", icon: PencilIcon },
  spent: { label: "Spent", icon: CoinsIcon },
  decided: { label: "Decided", icon: GavelIcon },
}

export function ChatTimeline({
  events,
  bots,
  budget,
}: {
  events: Promise<ChatEvent[]>
  bots: TimelineBot[]
  budget: ChatBudget | null
}) {
  const chatSpend = budget?.scopes.find((item) => item.scope === "chat")
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Open the timeline" />
        }
      >
        <HistoryIcon />
      </SheetTrigger>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Timeline</SheetTitle>
          {chatSpend && (
            <SheetDescription>{describeScope(chatSpend)}</SheetDescription>
          )}
        </SheetHeader>
        <Suspense
          fallback={
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          }
        >
          <TimelineEvents events={events} bots={bots} />
        </Suspense>
      </SheetContent>
    </Sheet>
  )
}

function TimelineEvents({
  events,
  bots,
}: {
  events: Promise<ChatEvent[]>
  bots: TimelineBot[]
}) {
  const all = use(events)
  const [category, setCategory] = useState<EventCategory | "all">("all")
  const shown =
    category === "all"
      ? all
      : all.filter((event) => event.category === category)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 pt-2">
      <ToggleGroup
        value={[category]}
        onValueChange={(value) =>
          setCategory((value[0] as EventCategory | undefined) ?? "all")
        }
        variant="outline"
        size="sm"
        spacing={0}
        className="mx-4 flex-wrap"
        aria-label="Show"
      >
        <ToggleGroupItem value="all">All</ToggleGroupItem>
        {(Object.keys(CATEGORIES) as EventCategory[]).map((key) => (
          <ToggleGroupItem key={key} value={key}>
            {CATEGORIES[key].label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {shown.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing yet</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <Timeline defaultValue={0} className="px-4 pb-6">
            {shown.map((event, index) => (
              <TimelineEntry
                key={event.id}
                event={event}
                step={index + 1}
                bot={bots.find((bot) => bot.id === event.botId)}
              />
            ))}
          </Timeline>
        </ScrollArea>
      )}
    </div>
  )
}

function TimelineEntry({
  event,
  step,
  bot,
}: {
  event: ChatEvent
  step: number
  bot: TimelineBot | undefined
}) {
  const { icon: Icon, label } = CATEGORIES[event.category]
  const at = new Date(event.createdAt)
  const actor = event.byUser
    ? "You"
    : event.botId
      ? (bot?.name ?? "A bot that has left")
      : "Limits"

  return (
    <TimelineItem
      step={step}
      className="group-data-[orientation=vertical]/timeline:ms-10"
    >
      <TimelineHeader>
        <TimelineSeparator className="group-data-[orientation=vertical]/timeline:-left-7 group-data-[orientation=vertical]/timeline:h-[calc(100%-1.5rem-0.25rem)] group-data-[orientation=vertical]/timeline:translate-y-6.5" />
        <TimelineDate render={<div />} className="flex items-center gap-1.5">
          {!event.byUser && bot && (
            <ChatAvatar seed={bot.avatar} className="size-4 rounded-sm" />
          )}
          <span className="font-mono text-accent-foreground">{actor}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={at.toISOString()}>
            {isToday(at) ? format(at, "HH:mm") : format(at, "MMM d, HH:mm")}
          </time>
        </TimelineDate>
        <TimelineTitle>{event.title}</TimelineTitle>
        <TimelineIndicator className="flex size-6 items-center justify-center border-none bg-muted text-muted-foreground group-data-[orientation=vertical]/timeline:-left-7">
          <Icon className="size-3.5" />
          <span className="sr-only">{label}</span>
        </TimelineIndicator>
      </TimelineHeader>
      {(event.detail || (event.cost ?? 0) > 0) && (
        <TimelineContent className="flex flex-col items-start gap-1.5">
          {event.detail && <p className="line-clamp-3">{event.detail}</p>}
          {(event.cost ?? 0) > 0 && (
            <Badge variant="outline">{formatCost(event.cost ?? 0)}</Badge>
          )}
        </TimelineContent>
      )}
    </TimelineItem>
  )
}
