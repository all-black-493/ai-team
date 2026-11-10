import { nanoid } from "nanoid"
import { relations } from "drizzle-orm"
import {
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core"
import { createInsertSchema } from "drizzle-zod"
import type { z } from "zod"

// Relative, not "@/": drizzle-kit loads this file without the tsconfig paths.
import { DEFAULT_MODEL } from "../lib/models"

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
    // Which model the bot runs on: an ID from lib/models.ts. Changed from the
    // composer of the bot's own chat.
    model: text("model").notNull().default(DEFAULT_MODEL),
    // ID of the bot's Daytona sandbox, created and deleted with the bot.
    sandboxId: text("sandbox_id"),
    // A signed noVNC link to the sandbox's desktop, kept and reused: Daytona
    // shows its preview warning once per link, not once per visit.
    desktopUrl: text("desktop_url"),
    desktopUrlExpiresAt: timestamp("desktop_url_expires_at", {
      withTimezone: true,
    }),
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
}).omit({
  id: true,
  userId: true,
  // Set on its own, from the model picker.
  model: true,
  sandboxId: true,
  desktopUrl: true,
  desktopUrlExpiresAt: true,
  createdAt: true,
})

export type BotInsert = z.infer<typeof botInsertSchema>

export const chatKind = pgEnum("chat_kind", ["direct", "group"])

export const chats = pgTable(
  "chats",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    // Clerk user ID of the chat's owner.
    userId: text("user_id").notNull(),
    kind: chatKind("kind").notNull().default("direct"),
    // Null for direct chats, which show the bot's name instead.
    name: text("name"),
    lastMessagePreview: text("last_message_preview"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("chats_user_id_idx").on(t.userId)]
)

export type Chat = typeof chats.$inferSelect
export type NewChat = typeof chats.$inferInsert

// Which bots are in which chat: one row for a direct chat, several for a
// group. Rows go away with their chat or bot.
export const chatMembers = pgTable(
  "chat_members",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.chatId, t.botId] }),
    index("chat_members_bot_id_idx").on(t.botId),
  ]
)

export type ChatMember = typeof chatMembers.$inferSelect
export type NewChatMember = typeof chatMembers.$inferInsert

export const botsRelations = relations(bots, ({ many }) => ({
  memberships: many(chatMembers),
}))

export const chatsRelations = relations(chats, ({ many }) => ({
  members: many(chatMembers),
}))

export const chatMembersRelations = relations(chatMembers, ({ one }) => ({
  chat: one(chats, { fields: [chatMembers.chatId], references: [chats.id] }),
  bot: one(bots, { fields: [chatMembers.botId], references: [bots.id] }),
}))

export const messageRating = pgEnum("message_rating", ["up", "down"])

// The user's thumbs up or down on a bot's answer. The messages themselves
// live in the chat agent's transcript storage on Trigger.dev, so this keys
// on the message's ID there. Gone with the chat.
export const messageRatings = pgTable(
  "message_ratings",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    rating: messageRating("rating").notNull(),
    ratedAt: timestamp("rated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chatId, t.messageId] })]
)

export type MessageRating = (typeof messageRating.enumValues)[number]
