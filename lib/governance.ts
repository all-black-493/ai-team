// How a group chat governs itself: what a role can let a bot do, the roles
// every group starts with, and what a moderator can do about a bot that
// breaks the group's constitution. Data only, shared by the database schema,
// the chat agent and the UI.

export const PERMISSIONS = {
  hand_off: "Hand messages to other bots",
  consult: "Ask other bots to work on something at the same time",
  use_sandbox: "Use its sandbox: commands, files and the desktop",
  propose_tasks: "Propose tasks and take them on",
  delegate_tasks: "Delegate tasks to other bots, who do them at once",
  edit_shared_memory: "Write the group's shared memory",
  call_votes: "Call votes on the group's decisions",
  vote: "Vote on the group's decisions",
  flag: "Flag messages that break the constitution",
  moderate: "Review flags and discipline bots",
  manage_members: "Add and remove bots",
  manage_roles: "Create, change, delete and assign roles",
  edit_constitution: "Write and amend the constitution",
  manage_settings: "Rename the group",
} as const

export type Permission = keyof typeof PERMISSIONS

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[]

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && value in PERMISSIONS
}

// Every group starts with these. Admin always has every permission; the
// other two can be changed, and none of them deleted. A bot without a role
// counts as a Member.
export const BUILT_IN_ROLES = {
  admin: {
    name: "Admin",
    description: "Runs the group",
    permissions: ALL_PERMISSIONS,
  },
  moderator: {
    name: "Moderator",
    description: "Keeps the group to its constitution",
    permissions: [
      "hand_off",
      "consult",
      "use_sandbox",
      "propose_tasks",
      "edit_shared_memory",
      "call_votes",
      "vote",
      "flag",
      "moderate",
    ],
  },
  member: {
    name: "Member",
    description: "Chats, collaborates and proposes tasks",
    permissions: [
      "hand_off",
      "consult",
      "use_sandbox",
      "propose_tasks",
      "edit_shared_memory",
      "call_votes",
      "vote",
      "flag",
    ],
  },
} as const satisfies Record<
  string,
  { name: string; description: string; permissions: readonly Permission[] }
>

export type BuiltInRole = keyof typeof BUILT_IN_ROLES

export const ROLE_KINDS = ["admin", "moderator", "member", "custom"] as const

export type RoleKind = (typeof ROLE_KINDS)[number]

// The bot every group gets, to keep it to its constitution.
export const DEFAULT_MODERATOR = {
  name: "Moderator",
  job: "Keeps the group to its constitution",
}

// What a moderator can do about a flagged message, mildest first.
export const MODERATION_ACTIONS = {
  warning: "Warning",
  reminder: "Reminder",
  task_reassignment: "Task reassignment",
  temporary_restriction: "Temporary restriction",
  suspension: "Suspension",
  removal: "Removal",
} as const

export type ModerationAction = keyof typeof MODERATION_ACTIONS

export const FLAG_STATUSES = [
  "awaiting_response",
  "awaiting_review",
  "resolved",
  "dismissed",
] as const

export type FlagStatus = (typeof FLAG_STATUSES)[number]

export const FLAG_STATUS_LABELS: Record<FlagStatus, string> = {
  awaiting_response: "Awaiting a response",
  awaiting_review: "Under review",
  resolved: "Resolved",
  dismissed: "Dismissed",
}

export const TASK_STATUSES = ["open", "in_progress", "done", "dropped"] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  dropped: "Dropped",
}

// The longest a restriction or suspension can last, in hours.
export const MAX_SANCTION_HOURS = 24 * 7

// A short, stable reference to a message, for bots to cite and flag it by.
export const messageRef = (messageId: string) => messageId.slice(-8)

// The most bots one consult or delegate call sets to work at once.
export const MAX_PARALLEL_BOTS = 6

// Every ballot can abstain. It counts as cast, not for an option.
export const ABSTAIN = "Abstain"
