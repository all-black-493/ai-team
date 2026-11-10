import { nanoid } from "nanoid"
import { relations } from "drizzle-orm"
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"
import { createInsertSchema } from "drizzle-zod"
import { z } from "zod"

// Relative, not "@/": drizzle-kit loads this file without the tsconfig paths.
import {
  FLAG_STATUSES,
  MODERATION_ACTIONS,
  ROLE_KINDS,
  TASK_STATUSES,
  type ModerationAction,
  type Permission,
} from "../lib/governance"
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
    // Set on a bot that belongs to one group chat, such as the moderator
    // every group gets: it has no sandbox and no chat of its own, isn't
    // offered for other groups, and is deleted with its group.
    groupChatId: text("group_chat_id").references((): AnyPgColumn => chats.id, {
      onDelete: "cascade",
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
  groupChatId: true,
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
    // A group's constitution: the rules every bot in it is bound by, in
    // Markdown, written by its bots with the right to. Null until then.
    constitution: text("constitution"),
    constitutionUpdatedAt: timestamp("constitution_updated_at", {
      withTimezone: true,
    }),
    // The bot that last wrote it.
    constitutionUpdatedBy: text("constitution_updated_by"),
    // A group's shared memory: notes all its bots read each turn and write
    // to, such as decisions and plans, kept on the group rather than in any
    // one bot's sandbox. Null until a bot writes it.
    sharedMemory: text("shared_memory"),
    sharedMemoryUpdatedAt: timestamp("shared_memory_updated_at", {
      withTimezone: true,
    }),
    sharedMemoryUpdatedBy: text("shared_memory_updated_by"),
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

// A group's roles: each gives the bots that hold it a set of permissions
// (lib/governance.ts). Every group starts with Admin, Moderator and Member;
// bots with the right to can add their own, change them and delete them.
export const groupRoleKind = pgEnum("group_role_kind", ROLE_KINDS)

export const groupRoles = pgTable(
  "group_roles",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    kind: groupRoleKind("kind").notNull().default("custom"),
    name: text("name").notNull(),
    description: text("description"),
    permissions: text("permissions")
      .array()
      .$type<Permission[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("group_roles_chat_id_name_idx").on(t.chatId, t.name)]
)

export type GroupRole = typeof groupRoles.$inferSelect

// Which bots are in which chat: one row for a direct chat, several for a
// group. Rows go away with their chat or bot. In a group each bot holds one
// role; one with none, as when its role is deleted, counts as a Member.
export const chatMembers = pgTable(
  "chat_members",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    roleId: text("role_id").references(() => groupRoles.id, {
      onDelete: "set null",
    }),
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

const chatMemberInsertSchema = createInsertSchema(chatMembers)

// What a user may send to create or edit a group chat: its name, the user's
// bots in it, and each one's role. A role is a role's ID, or for a group
// that doesn't exist yet, a built-in role's kind. The group's own bots, such
// as its moderator, stay in it either way. The dialog and the actions both
// validate with it, so the limits and messages live here once.
export const groupChatInsertSchema = createInsertSchema(chats, {
  // Required here, where the column allows null: only direct chats go
  // without a name.
  name: z
    .string()
    .trim()
    .min(1, "Give the group a name.")
    .max(50, "Keep the name under 50 characters."),
})
  .pick({ name: true })
  .extend({
    botIds: z
      .array(chatMemberInsertSchema.shape.botId)
      .min(2, "Pick at least two bots.")
      .refine((ids) => new Set(ids).size === ids.length, "Pick each bot once."),
    roles: z.record(
      chatMemberInsertSchema.shape.botId,
      z.string().min(1, "Pick a role.")
    ),
  })

export type GroupChatInsert = z.infer<typeof groupChatInsertSchema>

// A flag on a bot's message in a group, for breaking the constitution. The
// bot answers it first, then a moderator reviews it and decides. Messages
// live in the agent's transcript storage, so this keys on the message's ID.
export const flagStatus = pgEnum("flag_status", FLAG_STATUSES)

// The flagged bot's side of it, in its own words.
export type FlagResponse = {
  explanation: string
  challenge?: string
  evidence?: string
  request?: string
}

export const messageFlags = pgTable(
  "message_flags",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    // The bot that wrote the message.
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    // The bot that flagged it, or null for the user.
    flaggedBy: text("flagged_by").references(() => bots.id, {
      onDelete: "set null",
    }),
    // The rule it's said to break, and how.
    rule: text("rule"),
    reason: text("reason").notNull(),
    status: flagStatus("status").notNull().default("awaiting_response"),
    response: jsonb("response").$type<FlagResponse>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("message_flags_chat_id_idx").on(t.chatId)]
)

export type MessageFlag = typeof messageFlags.$inferSelect

// What a flag's user sends: the message, its writer, and why.
export const messageFlagInsertSchema = createInsertSchema(messageFlags, {
  rule: (s) => s.trim().max(500, "Keep the rule under 500 characters."),
  reason: (s) =>
    s
      .trim()
      .min(1, "Say what's wrong with the message.")
      .max(1000, "Keep the reason under 1,000 characters."),
}).pick({ messageId: true, botId: true, rule: true, reason: true })

export type MessageFlagInsert = z.infer<typeof messageFlagInsertSchema>

// What a moderator did about a flag. Restrictions and suspensions last
// until `expiresAt`; the rest are on record.
export const moderationAction = pgEnum(
  "moderation_action",
  Object.keys(MODERATION_ACTIONS) as [ModerationAction, ...ModerationAction[]]
)

export type ModerationDetails = {
  // A restriction's withheld permissions.
  permissions?: Permission[]
  // A task reassignment's task and new assignee.
  taskId?: string
  toBotId?: string
}

export const moderationActions = pgTable(
  "moderation_actions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    flagId: text("flag_id").references(() => messageFlags.id, {
      onDelete: "set null",
    }),
    // The bot it was taken against, and the moderator who took it.
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    moderatorId: text("moderator_id").references(() => bots.id, {
      onDelete: "set null",
    }),
    action: moderationAction("action").notNull(),
    reason: text("reason").notNull(),
    rule: text("rule"),
    details: jsonb("details").$type<ModerationDetails>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("moderation_actions_chat_id_idx").on(t.chatId)]
)

export type ModerationRecord = typeof moderationActions.$inferSelect

// Work the group's bots propose, take on and finish.
export const groupTaskStatus = pgEnum("group_task_status", TASK_STATUSES)

export const groupTasks = pgTable(
  "group_tasks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    details: text("details"),
    proposedBy: text("proposed_by").references(() => bots.id, {
      onDelete: "set null",
    }),
    assigneeId: text("assignee_id").references(() => bots.id, {
      onDelete: "set null",
    }),
    status: groupTaskStatus("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("group_tasks_chat_id_idx").on(t.chatId)]
)

export type GroupTask = typeof groupTasks.$inferSelect

export const botsRelations = relations(bots, ({ many }) => ({
  memberships: many(chatMembers),
}))

export const chatsRelations = relations(chats, ({ many }) => ({
  members: many(chatMembers),
  roles: many(groupRoles),
}))

export const groupRolesRelations = relations(groupRoles, ({ one }) => ({
  chat: one(chats, { fields: [groupRoles.chatId], references: [chats.id] }),
}))

export const chatMembersRelations = relations(chatMembers, ({ one }) => ({
  chat: one(chats, { fields: [chatMembers.chatId], references: [chats.id] }),
  bot: one(bots, { fields: [chatMembers.botId], references: [bots.id] }),
  role: one(groupRoles, {
    fields: [chatMembers.roleId],
    references: [groupRoles.id],
  }),
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
