import "server-only"

import { auth } from "@clerk/nextjs/server"

import { loadLimits } from "@/chats/budget-data"

export async function getSettings() {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) return null
  return loadLimits(userId)
}
