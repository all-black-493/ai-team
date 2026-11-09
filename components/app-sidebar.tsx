import Link from "next/link"
import { Suspense } from "react"
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs"
import { BotIcon, LogInIcon, UserPlusIcon } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar"

// The DESIGN.md icon rail: 49px collapsed, 240px open, canvas fill with a
// hairline edge.
export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarTrigger />
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
