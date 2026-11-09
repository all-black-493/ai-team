"use client"

import { useState } from "react"
import { BotIcon, ChevronDownIcon, UsersIcon } from "lucide-react"

import { BotDialog } from "@/components/bot-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenuButton } from "@/components/ui/sidebar"

// Arena's wordmark menu: the brand opens a menu of create actions. The bot
// dialog sits beside the menu, not inside it, so it stays open after the
// menu closes.
export function SidebarBrandMenu() {
  const [botDialogOpen, setBotDialogOpen] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<SidebarMenuButton />}>
          <span className="font-display text-heading">AI Team</span>
          {/* Points up while the menu is open, like Arena's. */}
          <ChevronDownIcon className="transition-transform in-data-popup-open:rotate-180" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setBotDialogOpen(true)}>
              <BotIcon />
              Create a new bot
            </DropdownMenuItem>
            {/* Group chats aren't built yet, so this only closes the menu. */}
            <DropdownMenuItem>
              <UsersIcon />
              Create a group chat
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <BotDialog open={botDialogOpen} onOpenChange={setBotDialogOpen} />
    </>
  )
}
