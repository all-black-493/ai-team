import { nanoid } from "nanoid"
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { createInsertSchema } from "drizzle-zod"
import type { z } from "zod"

export const bots = pgTable(
  "bots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    // Clerk user ID of the bot's owner.
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    // Seed for the bot's generated face.
    avatar: text("avatar")
      .notNull()
      .$defaultFn(() => nanoid()),
    // What the bot is for, in a phrase.
    job: text("job").notNull(),
    // How the bot should go about its job.
    instructions: text("instructions"),
    // ID of the bot's sandbox, created lazily.
    sandboxId: text("sandbox_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("bots_user_id_idx").on(t.userId)]
)

export type Bot = typeof bots.$inferSelect
export type NewBot = typeof bots.$inferInsert

// What a user may send when creating a bot. The form and createBot both
// validate with it, so the limits and messages live here once.
export const botInsertSchema = createInsertSchema(bots, {
  name: (s) =>
    s
      .trim()
      .min(1, "Give your bot a name.")
      .max(50, "Keep the name under 50 characters."),
  avatar: (s) => s.trim().min(1, "Pick a face.").max(64),
  job: (s) =>
    s
      .trim()
      .min(1, "Say what the bot is for.")
      .max(80, "Keep the job to a short phrase."),
  instructions: (s) =>
    s.trim().max(2000, "Keep the instructions under 2,000 characters."),
}).omit({ id: true, userId: true, sandboxId: true, createdAt: true })

export type BotInsert = z.infer<typeof botInsertSchema>
