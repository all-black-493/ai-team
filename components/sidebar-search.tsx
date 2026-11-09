"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { formatDistanceToNowStrict } from "date-fns"
import { SearchIcon } from "lucide-react"

import { ChatAvatar } from "@/components/chat-avatar"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import type { UserChat } from "@/queries/bot"

// components/ui/input.tsx's default look (minus file and invalid states), so
// the button reads as a search field. The outline variant's hover stays;
// dark:hover:bg-muted keeps it in dark mode, where the input fill would win.
const inputClasses =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30 dark:hover:bg-muted dark:disabled:bg-input/80"

// The modifier key to show: ⌘ on Apple devices, Ctrl elsewhere. The server
// can't know, so it renders ⌘ and the client corrects it after hydration.
const noSubscribe = () => () => {}
function useModifierKey() {
  return useSyncExternalStore(
    noSubscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl"),
    () => "⌘"
  )
}

// Search over the user's chats: a field-like button (an icon in the collapsed
// rail) that opens a command dialog. Cmd+K or Ctrl+K toggles it anywhere.
export function SidebarSearch({ chats }: { chats: UserChat[] }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const modifier = useModifierKey()

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  function openChat(chatId: string) {
    setOpen(false)
    router.push(`/chats/${chatId}`)
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className={cn(
          inputClasses,
          "justify-start font-normal text-muted-foreground group-data-[collapsible=icon]:hidden"
        )}
      >
        <SearchIcon data-icon="inline-start" />
        Search
        <KbdGroup className="ml-auto">
          <Kbd>{modifier}</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </Button>
      <SidebarMenu className="hidden group-data-[collapsible=icon]:flex">
        <SidebarMenuItem>
          <SidebarMenuButton tooltip="Search" onClick={() => setOpen(true)}>
            <SearchIcon />
            <span>Search</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search chats"
        description="Find a chat by its name or last message."
      >
        {/* Match on the title and preview only; the value is just a unique id. */}
        <Command
          filter={(_value, search, keywords) =>
            keywords?.some((word) =>
              word.toLowerCase().includes(search.toLowerCase())
            )
              ? 1
              : 0
          }
        >
          <CommandInput placeholder="Search chats..." />
          <CommandList>
            <CommandEmpty>No chats found.</CommandEmpty>
            <CommandGroup heading="Chats">
              {chats.map((chat) => (
                <CommandItem
                  key={chat.id}
                  value={chat.id}
                  keywords={[chat.title, chat.lastMessagePreview ?? ""]}
                  onSelect={() => openChat(chat.id)}
                >
                  <ChatAvatar
                    seed={chat.bot?.avatar ?? chat.id}
                    animated="hover"
                    className="rounded-md"
                  />
                  <div className="grid min-w-0 flex-1 leading-tight">
                    <span className="truncate">{chat.title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {chat.lastMessagePreview ?? "No messages yet"}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNowStrict(chat.lastMessageAt)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
