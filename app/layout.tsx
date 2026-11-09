import { cookies } from "next/headers"
import { ClerkProvider } from "@clerk/nextjs"
import { shadcn } from "@clerk/ui/themes"
import { Geist, Geist_Mono, Newsreader } from "next/font/google"

import "./globals.css"
import { AppSidebar } from "@/components/app-sidebar"
import { ThemeProvider } from "@/components/theme-provider"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

// Display serif from DESIGN.md (stands in for Arena's Martina Plantijn Light).
const fontDisplay = Newsreader({
  subsets: ["latin"],
  weight: "300",
  style: ["normal", "italic"],
  variable: "--font-display",
})

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // The rail starts collapsed, like Arena's, then remembers the user's choice.
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value === "true"

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        geist.variable,
        fontDisplay.variable
      )}
    >
      <body className="flex min-h-svh flex-col">
        <ClerkProvider appearance={{ theme: shadcn }}>
          <ThemeProvider>
            <TooltipProvider>
              <SidebarProvider
                defaultOpen={sidebarOpen}
                style={
                  {
                    "--sidebar-width": "15rem",
                    "--sidebar-width-icon": "calc(3rem + 1px)",
                  } as React.CSSProperties
                }
              >
                <AppSidebar />
                <SidebarInset>
                  <header className="flex h-12 shrink-0 items-center border-b px-2 md:hidden">
                    <SidebarTrigger />
                  </header>
                  {children}
                </SidebarInset>
              </SidebarProvider>
            </TooltipProvider>
            <Toaster />
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  )
}
