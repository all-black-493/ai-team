import Link from "next/link"
import { Suspense } from "react"
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs"
import { formatDistanceToNowStrict } from "date-fns"
import { BotIcon, LogInIcon, UserPlusIcon } from "lucide-react"

import { ChatAvatar } from "@/components/chat-avatar"
import { GroupChatAvatar } from "@/components/group-chat-avatar"
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
import { getUserBots, getUserChats } from "@/queries/bot"

// The DESIGN.md icon rail: 49px collapsed, 240px open, canvas fill with a
// hairline edge.
export function AppSidebar() {
  // Not awaited: only the group chat dialog reads it, so the header doesn't
  // wait for it.
  const bots = getUserBots()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {/* Open: brand menu left, toggle right. Collapsed: toggle above the brand icon. */}
        <div className="flex items-center group-data-[collapsible=icon]:flex-col-reverse group-data-[collapsible=icon]:gap-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarBrandMenu bots={bots} />
            </SidebarMenuItem>
          </SidebarMenu>
          {/* size-8, like every SidebarMenuButton in the collapsed rail. */}
          <SidebarTrigger size="icon" />
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
                {/* 32px, the size of every other button in the rail. */}
                <UserButton
                  appearance={{
                    elements: {
                      userButtonAvatarBox: { width: "2rem", height: "2rem" },
                    },
                  }}
                />
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

// The signed-in user's chats. In the collapsed rail each shows as its bot's
// avatar, or a group's faces in the same square (the lg button shrinks to
// size-8 with no padding), with the title as a tooltip. Hidden when there are
// no chats or nobody is signed in.
async function ChatGroup() {
  const chats = await getUserChats()
  if (chats.length === 0) return null

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Chats</SidebarGroupLabel>
      {/* Collapsed, space the avatars 24px apart. */}
      <SidebarMenu className="group-data-[collapsible=icon]:gap-6">
        {chats.map((chat) => (
          <SidebarMenuItem key={chat.id}>
            <SidebarMenuButton
              size="lg"
              tooltip={chat.title}
              render={<Link href={`/chats/${chat.id}`} />}
            >
              {chat.kind === "group" ? (
                <GroupChatAvatar members={chat.members} />
              ) : (
                <ChatAvatar
                  seed={chat.members[0]?.avatar ?? chat.id}
                  animated="hover"
                  className="rounded-md"
                />
              )}
              <div className="grid flex-1 text-left text-sm leading-tight">
                {/* Room on the right for the widest time badge ("10 minutes"). */}
                <span className="truncate pr-20">{chat.title}</span>
                {chat.lastMessagePreview && (
                  <span className="truncate text-xs text-muted-foreground">
                    {chat.lastMessagePreview}
                  </span>
                )}
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
    <SidebarGroup>
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
