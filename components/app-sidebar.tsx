import Link from "next/link"
import { Suspense } from "react"
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs"
import { formatDistanceToNowStrict } from "date-fns"
import { BotIcon, LogInIcon, UserPlusIcon } from "lucide-react"

import { ChatAvatar } from "@/components/chat-avatar"
import { SidebarBrandMenu } from "@/components/sidebar-brand-menu"
import { SidebarSearch } from "@/components/sidebar-search"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { getUserChats } from "@/queries/bot"

// The DESIGN.md icon rail: 49px collapsed, 240px open, canvas fill with a
// hairline edge.
export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {/* Open: brand menu on the left, toggle on the right. Collapsed: toggle only. */}
        <div className="flex items-center">
          <SidebarMenu className="group-data-[collapsible=icon]:hidden">
            <SidebarMenuItem>
              <SidebarBrandMenu />
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarTrigger />
        </div>
        <Suspense fallback={<SidebarSearch chats={[]} />}>
          <ChatSearch />
        </Suspense>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton render={<Link href="/" />} tooltip="Bots">
                <BotIcon />
                <span>Bots</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <Suspense fallback={<ChatGroupSkeleton />}>
          <ChatGroup />
        </Suspense>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <Suspense>
            <Show when="signed-out">
              <SidebarMenuItem>
                <SignInButton>
                  <SidebarMenuButton tooltip="Sign in">
                    <LogInIcon />
                    <span>Sign in</span>
                  </SidebarMenuButton>
                </SignInButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SignUpButton>
                  <SidebarMenuButton tooltip="Sign up">
                    <UserPlusIcon />
                    <span>Sign up</span>
                  </SidebarMenuButton>
                </SignUpButton>
              </SidebarMenuItem>
            </Show>
            <Show when="signed-in">
              <SidebarMenuItem>
                <UserButton />
              </SidebarMenuItem>
            </Show>
          </Suspense>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

// Search needs the chats; getUserChats is cached, so this and ChatGroup share
// one query.
async function ChatSearch() {
  const chats = await getUserChats()
  return <SidebarSearch chats={chats} />
}

// The signed-in user's chats. Hidden in the collapsed rail and when there are
// no chats (or nobody is signed in).
async function ChatGroup() {
  const chats = await getUserChats()
  if (chats.length === 0) return null

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Chats</SidebarGroupLabel>
      <SidebarMenu>
        {chats.map((chat) => (
          <SidebarMenuItem key={chat.id}>
            <SidebarMenuButton
              size="lg"
              render={<Link href={`/chats/${chat.id}`} />}
            >
              <ChatAvatar
                seed={chat.bot?.avatar ?? chat.id}
                animated="hover"
                className="rounded-md"
              />
              <div className="grid flex-1 text-left text-sm leading-tight">
                {/* Room on the right for the widest time badge ("10 minutes"). */}
                <span className="truncate pr-20">{chat.title}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {chat.lastMessagePreview ?? "No messages yet"}
                </span>
              </div>
            </SidebarMenuButton>
            <SidebarMenuBadge>
              {formatDistanceToNowStrict(chat.lastMessageAt)}
            </SidebarMenuBadge>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}

function ChatGroupSkeleton() {
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Chats</SidebarGroupLabel>
      <SidebarMenu>
        {Array.from({ length: 3 }, (_, i) => (
          <SidebarMenuItem key={i}>
            <SidebarMenuSkeleton showIcon />
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
