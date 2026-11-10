"use client"

import { useState } from "react"
import {
  BotIcon,
  ChevronDownIcon,
  CirclePlusIcon,
  UsersIcon,
} from "lucide-react"

import { BotDialog } from "@/components/bot-dialog"
import { GroupChatDialog } from "@/components/group-chat-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar"
import type { UserBot } from "@/queries/bot"

// Arena's wordmark menu: the brand opens a menu of create actions. The
// dialogs sit beside the menu, not inside it, so they stay open after the
// menu closes.
export function SidebarBrandMenu({ bots }: { bots: Promise<UserBot[]> }) {
  const [botDialogOpen, setBotDialogOpen] = useState(false)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const { isMobile, state } = useSidebar()
  // Collapsed, the menu opens beside the rail instead of under the button.
  const side = !isMobile && state === "collapsed" ? "right" : "bottom"

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<SidebarMenuButton tooltip="Create" />}>
          {/* The collapsed rail shows only this icon; open, the wordmark. */}
          <CirclePlusIcon className="hidden group-data-[collapsible=icon]:block" />
          <span className="font-display text-heading">AI Team</span>
          {/* Points up while the menu is open, like Arena's. */}
          <ChevronDownIcon className="transition-transform in-data-popup-open:rotate-180" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side={side} className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setBotDialogOpen(true)}>
              <BotIcon />
              Create a new bot
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setGroupDialogOpen(true)}>
              <UsersIcon />
              Create a group chat
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <BotDialog open={botDialogOpen} onOpenChange={setBotDialogOpen} />
      <GroupChatDialog
        bots={bots}
        open={groupDialogOpen}
        onOpenChange={setGroupDialogOpen}
      />
    </>
  )
}
