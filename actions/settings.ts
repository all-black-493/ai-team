"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"

import { db } from "@/db"
import {
  userSettings,
  userSettingsInsertSchema,
  type UserSettingsInsert,
} from "@/db/schema"

// Saves the user's limits and approvals. They apply from each bot's next
// turn. Returns the saved settings.
export async function updateSettings(input: UserSettingsInsert) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated) {
    throw new Error("Unauthorized")
  }

  const values = userSettingsInsertSchema.parse(input)
  const [settings] = await db
    .insert(userSettings)
    .values({ ...values, userId })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { ...values, updatedAt: new Date() },
    })
    .returning()

  revalidatePath("/", "layout")
  return settings
}
