import { nanoid } from "nanoid"
import { relations, sql } from "drizzle-orm"
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  vector,
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
import { DEFAULT_LIMITS, LIMIT_CEILINGS } from "../lib/budget"
import { SANDBOX_DEFAULTS, SANDBOX_LIMITS } from "../lib/sandbox-policy"
import { DEFAULT_MODEL } from "../lib/models"
import {
  DEFAULT_REVIEW_DAYS,
  EMBEDDING,
  ISSUE_KINDS,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_SOURCES,
  parseRepository,
} from "../lib/knowledge"

export const networkPolicy = pgEnum("network_policy", [
  "default",
  "domains",
  "blocked",
])

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
    // Where the sandbox may connect out to, and when it stops and archives
    // itself while idle.
    networkPolicy: networkPolicy("network_policy").notNull().default("default"),
    allowedDomains: text("allowed_domains"),
    autoStopMinutes: integer("auto_stop_minutes")
      .notNull()
      .default(SANDBOX_DEFAULTS.autoStopMinutes),
    autoArchiveDays: integer("auto_archive_days")
      .notNull()
      .default(SANDBOX_DEFAULTS.autoArchiveDays),
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
  allowedDomains: (s) =>
    s
      .trim()
      .max(1000, "Keep the list under 1,000 characters.")
      .regex(
        /^$|^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\s*,\s*(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+)*$/i,
        "List domains separated by commas, such as github.com, *.npmjs.org."
      ),
  autoStopMinutes: z
    .number({ error: "Enter a number of minutes." })
    .int("Use whole minutes.")
    .min(1, "Stop after at least a minute.")
    .max(
      SANDBOX_LIMITS.autoStopMinutes,
      `Stop within ${SANDBOX_LIMITS.autoStopMinutes} minutes.`
    ),
  autoArchiveDays: z
    .number({ error: "Enter a number of days." })
    .int("Use whole days.")
    .min(1, "Archive after at least a day.")
    .max(
      SANDBOX_LIMITS.autoArchiveDays,
      `Archive within ${SANDBOX_LIMITS.autoArchiveDays} days.`
    ),
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
    // A group on autopilot: its bots carry on together, one after another,
    // without waiting for the user.
    autopilot: boolean("autopilot").notNull().default(false),
    // Autopilot turns since the user last took part, against its limit.
    autopilotTurns: integer("autopilot_turns").notNull().default(0),
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
    // What the assignee reported, once it worked on a delegated task.
    result: text("result"),
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

// One bot's ballot in a vote, with why.
export type Ballot = {
  botId: string
  choice: string
  reason: string
}

// A question a group's bots voted on. Every bot that may vote casts its
// ballot at once when the vote is called, so a vote is decided as it's
// recorded: `outcome` is the winning option, or null for a tie.
export const groupVotes = pgTable(
  "group_votes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    // The bot that called it.
    calledBy: text("called_by").references(() => bots.id, {
      onDelete: "set null",
    }),
    question: text("question").notNull(),
    options: text("options").array().notNull(),
    ballots: jsonb("ballots").$type<Ballot[]>().notNull(),
    outcome: text("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("group_votes_chat_id_idx").on(t.chatId)]
)

export type GroupVote = typeof groupVotes.$inferSelect

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

const dollarsColumn = (name: string) =>
  numeric(name, { precision: 12, scale: 6, mode: "number" })

// Each user's limits on what their bots spend and do, and which risky
// actions wait for their approval. A user without a row has the defaults.
export const userSettings = pgTable("user_settings", {
  userId: text("user_id").primaryKey(),
  // In US dollars; null for no limit.
  chatSpendLimit: dollarsColumn("chat_spend_limit").default(
    DEFAULT_LIMITS.chatSpendLimit
  ),
  userSpendLimit: dollarsColumn("user_spend_limit").default(
    DEFAULT_LIMITS.userSpendLimit
  ),
  dailySpendLimit: dollarsColumn("daily_spend_limit").default(
    DEFAULT_LIMITS.dailySpendLimit
  ),
  warnAtPercent: integer("warn_at_percent")
    .notNull()
    .default(DEFAULT_LIMITS.warnAtPercent),
  maxAutopilotTurns: integer("max_autopilot_turns")
    .notNull()
    .default(DEFAULT_LIMITS.maxAutopilotTurns),
  maxParallelBots: integer("max_parallel_bots")
    .notNull()
    .default(DEFAULT_LIMITS.maxParallelBots),
  maxTaskMinutes: integer("max_task_minutes")
    .notNull()
    .default(DEFAULT_LIMITS.maxTaskMinutes),
  maxToolCalls: integer("max_tool_calls")
    .notNull()
    .default(DEFAULT_LIMITS.maxToolCalls),
  maxShellCommands: integer("max_shell_commands")
    .notNull()
    .default(DEFAULT_LIMITS.maxShellCommands),
  // Older context is summarized once a turn's context passes this many
  // tokens; null never compacts.
  compactAfterTokens: integer("compact_after_tokens").default(
    DEFAULT_LIMITS.compactAfterTokens
  ),
  approveFileDeletes: boolean("approve_file_deletes").notNull().default(true),
  approveCodePushes: boolean("approve_code_pushes").notNull().default(true),
  approveRoleChanges: boolean("approve_role_changes").notNull().default(true),
  approveIntegrations: boolean("approve_integrations").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export type UserSettings = typeof userSettings.$inferSelect

const spendLimit = z
  .number({ error: "Enter an amount, or clear it for no limit." })
  .min(0.01, "Set at least a cent, or clear it for no limit.")
  .max(LIMIT_CEILINGS.spend, `Keep it under ${LIMIT_CEILINGS.spend} dollars.`)
  .nullable()
const count = (min: number, max: number, what: string) =>
  z
    .number({ error: `Enter a number of ${what}.` })
    .int(`Use a whole number of ${what}.`)
    .min(min, `Allow at least ${min} ${what}.`)
    .max(max, `Allow at most ${max} ${what}.`)

export const userSettingsInsertSchema = createInsertSchema(userSettings, {
  chatSpendLimit: spendLimit,
  userSpendLimit: spendLimit,
  dailySpendLimit: spendLimit,
  warnAtPercent: count(1, 100, "percent"),
  maxAutopilotTurns: count(1, LIMIT_CEILINGS.maxAutopilotTurns, "turns"),
  maxParallelBots: count(1, LIMIT_CEILINGS.maxParallelBots, "bots"),
  maxTaskMinutes: count(1, LIMIT_CEILINGS.maxTaskMinutes, "minutes"),
  maxToolCalls: count(1, LIMIT_CEILINGS.maxToolCalls, "tool calls"),
  maxShellCommands: count(0, LIMIT_CEILINGS.maxShellCommands, "commands"),
  compactAfterTokens: count(
    LIMIT_CEILINGS.compactMinTokens,
    LIMIT_CEILINGS.compactMaxTokens,
    "tokens"
  ).nullable(),
})
  .omit({ userId: true, updatedAt: true })
  .required()

export type UserSettingsInsert = z.infer<typeof userSettingsInsertSchema>

// Every model call a user's bots make, priced, for spend limits. Kept when a
// chat or bot is deleted: it still counts towards the user's and the day's.
export const usageKind = pgEnum("usage_kind", [
  "turn",
  "work",
  "ballot",
  "director",
  "summary",
  "embedding",
  "knowledge",
])

export const modelUsage = pgTable(
  "model_usage",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id").notNull(),
    chatId: text("chat_id").references(() => chats.id, {
      onDelete: "set null",
    }),
    botId: text("bot_id").references(() => bots.id, { onDelete: "set null" }),
    kind: usageKind("kind").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cost: dollarsColumn("cost").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("model_usage_user_id_created_at_idx").on(t.userId, t.createdAt),
    index("model_usage_chat_id_idx").on(t.chatId),
  ]
)

// What happened in a chat, for its timeline. A null bot is the user, for
// their own decisions, or the app, for its limits.
export const EVENT_CATEGORIES = [
  "did",
  "delegated",
  "changed",
  "spent",
  "decided",
] as const

export const eventCategory = pgEnum("event_category", EVENT_CATEGORIES)

export const chatEvents = pgTable(
  "chat_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    botId: text("bot_id").references(() => bots.id, { onDelete: "set null" }),
    byUser: boolean("by_user").notNull().default(false),
    category: eventCategory("category").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    cost: dollarsColumn("cost"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("chat_events_chat_id_created_at_idx").on(t.chatId, t.createdAt)]
)

export type ChatEvent = typeof chatEvents.$inferSelect
export type EventCategory = ChatEvent["category"]

export const TURN_KINDS = [
  "message",
  "regenerate",
  "approval",
  "handoff",
  "flag-response",
  "flag-review",
  "autopilot",
] as const

export const turnKind = pgEnum("turn_kind", TURN_KINDS)
export const turnStatus = pgEnum("turn_status", [
  "pending",
  "running",
  "done",
  "stopped",
  "failed",
])

// Every turn a chat runs. Turns the chat runs on its own are claimed here
// before they start, once per point in the conversation (`afterMessageId`),
// so a retry or a second tab can't run one twice, and one cut off can be
// picked up again.
export const agentTurns = pgTable(
  "agent_turns",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    botId: text("bot_id").references(() => bots.id, { onDelete: "set null" }),
    kind: turnKind("kind").notNull(),
    automatic: boolean("automatic").notNull().default(false),
    status: turnStatus("status").notNull().default("pending"),
    afterMessageId: text("after_message_id").notNull(),
    reason: text("reason"),
    attempts: integer("attempts").notNull().default(0),
    // Times it was picked up again after being cut off or left waiting.
    recoveries: integer("recoveries").notNull().default(0),
    // A turn that answered what an earlier turn had already answered, and
    // requests for a turn already claimed, refused.
    duplicate: boolean("duplicate").notNull().default(false),
    duplicateRequests: integer("duplicate_requests").notNull().default(0),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    firstTokenMs: integer("first_token_ms"),
    durationMs: integer("duration_ms"),
    compacted: boolean("compacted").notNull().default(false),
    // The bot asked the user something, and whether its memory already held
    // the answer.
    asked: boolean("asked").notNull().default(false),
    repeatedQuestion: boolean("repeated_question").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("agent_turns_chat_id_created_at_idx").on(t.chatId, t.createdAt),
    index("agent_turns_user_id_created_at_idx").on(t.userId, t.createdAt),
    uniqueIndex("agent_turns_automatic_idx")
      .on(t.chatId, t.afterMessageId)
      .where(sql`${t.automatic}`),
  ]
)

export type AgentTurn = typeof agentTurns.$inferSelect

// What older context was compacted into. Each summary covers everything up
// to `upToMessageId`, earlier summaries included, and they're all kept.
export const chatSummaries = pgTable(
  "chat_summaries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    upToMessageId: text("up_to_message_id").notNull(),
    summary: text("summary").notNull(),
    messageCount: integer("message_count").notNull(),
    tokensBefore: integer("tokens_before"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("chat_summaries_chat_id_idx").on(t.chatId, t.createdAt)]
)

export const MEMORY_CATEGORIES = [
  "user",
  "preference",
  "project",
  "decision",
  "fact",
  "task",
  "other",
] as const

export const memoryCategory = pgEnum("memory_category", MEMORY_CATEGORIES)

// A bot's memory: one row per version of a note, by key. Changing a note
// adds a version; forgetting one adds a deleted version, so its history
// stays.
export const botMemories = pgTable(
  "bot_memories",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    category: memoryCategory("category").notNull(),
    content: text("content").notNull(),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    version: integer("version").notNull().default(1),
    current: boolean("current").notNull().default(true),
    deleted: boolean("deleted").notNull().default(false),
    chatId: text("chat_id").references(() => chats.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("bot_memories_current_key_idx")
      .on(t.botId, t.key)
      .where(sql`${t.current}`),
    index("bot_memories_search_idx").using(
      "gin",
      sql`to_tsvector('english', ${t.key} || ' ' || ${t.content})`
    ),
  ]
)

export type BotMemory = typeof botMemories.$inferSelect

// Each time memories were looked up for a bot, and whether its answer used
// any of them.
export const memoryRetrievals = pgTable(
  "memory_retrievals",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    chatId: text("chat_id").references(() => chats.id, {
      onDelete: "set null",
    }),
    turnId: text("turn_id"),
    source: text("source").notNull(),
    query: text("query").notNull(),
    memoryIds: text("memory_ids").array().notNull(),
    used: boolean("used"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("memory_retrievals_bot_id_idx").on(t.botId, t.createdAt)]
)

// Every Daytona call a bot's sandbox makes, timed, for startup time, error
// rate and an estimate of what the sandbox costs while it runs.
export const sandboxEvents = pgTable(
  "sandbox_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id"),
    botId: text("bot_id").references(() => bots.id, { onDelete: "set null" }),
    sandboxId: text("sandbox_id").notNull(),
    action: text("action").notNull(),
    // Whether a start found the sandbox stopped or archived.
    cold: boolean("cold").notNull().default(false),
    ok: boolean("ok").notNull(),
    durationMs: integer("duration_ms").notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sandbox_events_user_id_created_at_idx").on(t.userId, t.createdAt),
    index("sandbox_events_sandbox_id_idx").on(t.sandboxId, t.createdAt),
  ]
)

export const knowledgeKind = pgEnum("knowledge_kind", KNOWLEDGE_KINDS)
export const knowledgeSource = pgEnum("knowledge_source", KNOWLEDGE_SOURCES)
export const knowledgeStatus = pgEnum("knowledge_status", [
  "processing",
  "ready",
  "unchanged",
  "failed",
])
export const knowledgeIssueKind = pgEnum("knowledge_issue_kind", ISSUE_KINDS)
export const knowledgeIssueStatus = pgEnum("knowledge_issue_status", [
  "open",
  "resolved",
  "dismissed",
])

export const knowledgeCollections = pgTable(
  "knowledge_collections",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    // A group's shared collection: every bot in the group reads it there.
    groupChatId: text("group_chat_id").references(() => chats.id, {
      onDelete: "cascade",
    }),
    reviewAfterDays: integer("review_after_days")
      .notNull()
      .default(DEFAULT_REVIEW_DAYS),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("knowledge_collections_user_id_idx").on(t.userId),
    uniqueIndex("knowledge_collections_group_chat_id_idx").on(t.groupChatId),
  ]
)

export type KnowledgeCollection = typeof knowledgeCollections.$inferSelect

export const knowledgeCollectionInsertSchema = createInsertSchema(
  knowledgeCollections,
  {
    name: (s) =>
      s
        .trim()
        .min(1, "Name the collection.")
        .max(80, "Keep the name under 80 characters."),
    description: (s) =>
      s.trim().max(500, "Keep the description under 500 characters."),
    reviewAfterDays: z
      .number({ error: "Enter a number of days." })
      .int("Use whole days.")
      .min(1, "Review after at least a day.")
      .max(3650, "Review within 10 years."),
  }
).omit({
  id: true,
  userId: true,
  groupChatId: true,
  createdAt: true,
  updatedAt: true,
})

export type KnowledgeCollectionInsert = z.infer<
  typeof knowledgeCollectionInsertSchema
>

export const collectionBots = pgTable(
  "collection_bots",
  {
    collectionId: text("collection_id")
      .notNull()
      .references(() => knowledgeCollections.id, { onDelete: "cascade" }),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.botId] }),
    index("collection_bots_bot_id_idx").on(t.botId),
  ]
)

export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    collectionId: text("collection_id")
      .notNull()
      .references(() => knowledgeCollections.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: knowledgeKind("kind").notNull().default("document"),
    source: knowledgeSource("source").notNull().default("upload"),
    sourceUrl: text("source_url"),
    sourceRef: text("source_ref"),
    currentVersionId: text("current_version_id"),
    latestVersion: integer("latest_version").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // When the version in use last changed.
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("knowledge_documents_collection_id_idx").on(t.collectionId)]
)

export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect

export const knowledgeDocumentInsertSchema = createInsertSchema(
  knowledgeDocuments,
  {
    title: (s) =>
      s
        .trim()
        .min(1, "Give it a title.")
        .max(120, "Keep the title under 120 characters."),
    sourceUrl: (s) =>
      s
        .trim()
        .max(300)
        .refine(
          (url) => parseRepository(url) !== null,
          "Paste a GitHub repository link, such as https://github.com/owner/repo."
        ),
    sourceRef: (s) =>
      s
        .trim()
        .max(100, "Keep the branch under 100 characters.")
        .regex(/^[\w./-]*$/, "Use a branch, tag or commit name."),
  }
).omit({
  id: true,
  collectionId: true,
  source: true,
  currentVersionId: true,
  latestVersion: true,
  archived: true,
  createdAt: true,
  updatedAt: true,
})

export const knowledgeDetailsSchema = knowledgeDocumentInsertSchema.pick({
  title: true,
  kind: true,
})

export type KnowledgeDetails = z.infer<typeof knowledgeDetailsSchema>

export const knowledgeNoteSchema = knowledgeDocumentInsertSchema
  .pick({ title: true, kind: true })
  .extend({
    content: z
      .string()
      .trim()
      .min(1, "Write the note.")
      .max(200_000, "Keep the note under 200,000 characters."),
  })

export type KnowledgeNote = z.infer<typeof knowledgeNoteSchema>

export const repositoryImportSchema = knowledgeDocumentInsertSchema
  .pick({ sourceUrl: true, sourceRef: true, kind: true })
  .required({ sourceUrl: true })

export type RepositoryImport = z.infer<typeof repositoryImportSchema>

export const knowledgeVersions = pgTable(
  "knowledge_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    documentId: text("document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: knowledgeStatus("status").notNull().default("processing"),
    error: text("error"),
    blobPathname: text("blob_pathname"),
    fileName: text("file_name").notNull(),
    contentType: text("content_type"),
    size: integer("size"),
    sha256: text("sha256"),
    commit: text("commit"),
    note: text("note"),
    sections: integer("sections"),
    chunks: integer("chunks"),
    characters: integer("characters"),
    truncated: boolean("truncated").notNull().default(false),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("knowledge_versions_document_version_idx").on(
      t.documentId,
      t.version
    ),
  ]
)

export type KnowledgeVersion = typeof knowledgeVersions.$inferSelect

export const knowledgeVersionInsertSchema = createInsertSchema(
  knowledgeVersions,
  {
    note: (s) => s.trim().max(300, "Keep the note under 300 characters."),
  }
).pick({ note: true })

// A version's text, split into passages, each embedded for semantic search
// and indexed for keyword search. Only the version in use is `current`.
export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    documentId: text("document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    versionId: text("version_id")
      .notNull()
      .references(() => knowledgeVersions.id, { onDelete: "cascade" }),
    collectionId: text("collection_id")
      .notNull()
      .references(() => knowledgeCollections.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    section: text("section").notNull(),
    content: text("content").notNull(),
    tokens: integer("tokens"),
    embedding: vector("embedding", {
      dimensions: EMBEDDING.dimensions,
    }).notNull(),
    current: boolean("current").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("knowledge_chunks_embedding_idx").using(
      "lakebase_ann",
      t.embedding.op("vector_cosine_ops")
    ),
    index("knowledge_chunks_search_idx").using(
      "gin",
      sql`to_tsvector('english', ${t.section} || ' ' || ${t.content})`
    ),
    index("knowledge_chunks_current_idx")
      .on(t.collectionId)
      .where(sql`${t.current}`),
    index("knowledge_chunks_version_id_idx").on(t.versionId, t.ordinal),
  ]
)

export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect

// Passages that disagree, one that a newer one replaces, or near copies.
export const knowledgeIssues = pgTable(
  "knowledge_issues",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    collectionId: text("collection_id")
      .notNull()
      .references(() => knowledgeCollections.id, { onDelete: "cascade" }),
    kind: knowledgeIssueKind("kind").notNull(),
    status: knowledgeIssueStatus("status").notNull().default("open"),
    documentId: text("document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    chunkId: text("chunk_id")
      .notNull()
      .references(() => knowledgeChunks.id, { onDelete: "cascade" }),
    otherDocumentId: text("other_document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    otherChunkId: text("other_chunk_id")
      .notNull()
      .references(() => knowledgeChunks.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    // Which side the checker found more current, when it could tell.
    newerDocumentId: text("newer_document_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("knowledge_issues_collection_id_idx").on(t.collectionId, t.status),
    uniqueIndex("knowledge_issues_pair_idx").on(t.chunkId, t.otherChunkId),
  ]
)

export type KnowledgeIssue = typeof knowledgeIssues.$inferSelect

// Each time passages were looked up for a bot, and how many its answer cited.
export const knowledgeRetrievals = pgTable(
  "knowledge_retrievals",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id").notNull(),
    botId: text("bot_id").references(() => bots.id, { onDelete: "set null" }),
    chatId: text("chat_id").references(() => chats.id, {
      onDelete: "set null",
    }),
    turnId: text("turn_id"),
    source: text("source").notNull(),
    query: text("query").notNull(),
    chunkIds: text("chunk_ids").array().notNull(),
    durationMs: integer("duration_ms"),
    cited: integer("cited"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("knowledge_retrievals_user_id_idx").on(t.userId, t.createdAt),
    index("knowledge_retrievals_turn_id_idx").on(t.turnId),
  ]
)
