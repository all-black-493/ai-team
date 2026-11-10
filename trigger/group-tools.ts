import { tool, type ToolSet, type UIMessage } from "ai"
import { and, eq, isNull, notInArray } from "drizzle-orm"
import { z } from "zod"

import {
  answerFlag,
  can,
  loadGroupState,
  type GroupMember,
  type GroupState,
  type PendingTurn,
} from "@/chats/governance-data"
import { db } from "@/db"
import {
  bots,
  chatMembers,
  chats,
  groupRoles,
  groupTasks,
  messageFlags,
  moderationActions,
} from "@/db/schema"
import {
  ALL_PERMISSIONS,
  MAX_SANCTION_HOURS,
  MODERATION_ACTIONS,
  messageRef,
  type ModerationAction,
} from "@/lib/governance"
import { createCollaborationTools } from "@/trigger/collaboration"
import { taskRef } from "@/trigger/prompt"

// Names match ignoring case and spaces.
const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

const permissionEnum = z.enum(
  ALL_PERMISSIONS as [
    (typeof ALL_PERMISSIONS)[number],
    ...typeof ALL_PERMISSIONS,
  ]
)

// Lookups in the group as it is when a tool runs: a call earlier in the same
// turn may have changed it, such as a role just created.
const roleIn = (state: GroupState, name: string) =>
  state.roles.find((role) => same(role.name, name))
const memberIn = (state: GroupState, name: string) =>
  state.members.find((member) => same(member.name, name))
const userBotsOf = (state: GroupState) =>
  state.members.filter((member) => !member.groupChatId)

// The tools a bot governs its group and works with the others with, for
// this turn: the ones its role allows, less any a moderator has restricted.
// A flagged bot answering its flag gets answer_flag, and a moderator
// reviewing one gets moderate, and nothing else. The page loads the group
// again after those that change it (chats/group.ts).
export async function createGroupTools({
  state,
  bot,
  turn,
  history,
}: {
  state: GroupState
  bot: GroupMember
  turn?: PendingTurn
  history: UIMessage[]
}): Promise<ToolSet> {
  const chatId = state.id
  // The user's bots in the group: it keeps at least two.
  const userBots = userBotsOf(state)

  // Bots' messages, by the reference they're cited with.
  const messageByRef = (ref: string) => {
    const wanted = ref.trim().replace(/^#/, "")
    return history.find(
      (message) =>
        message.role === "assistant" && messageRef(message.id) === wanted
    )
  }
  const authorOf = (message: UIMessage) =>
    (message.metadata as { botId?: string } | undefined)?.botId

  const tools: ToolSet = {}

  // Answering a flag, and deciding one, are turns of their own.
  if (turn?.kind === "flag-response" && turn.botId === bot.id) {
    tools.answer_flag = tool({
      description:
        "Give your side on the flag against your message, for the moderator to review before deciding. Use it once, after you've written your response to the group.",
      inputSchema: z.object({
        explanation: z.string().min(1).describe("Why you did what you did"),
        challenge: z
          .string()
          .optional()
          .describe("Where you think the flag misreads the constitution"),
        evidence: z
          .string()
          .optional()
          .describe("What supports you: messages, facts, results"),
        request: z
          .string()
          .optional()
          .describe("What you ask the moderator to consider"),
      }),
      execute: async (response) => {
        const flag = await answerFlag(turn.flag.id, response)
        if (!flag) throw new Error("This flag has already been answered.")
        return { answered: true }
      },
    })
    return tools
  }

  if (turn?.kind === "flag-review" && turn.botId === bot.id) {
    tools.moderate = createModerateTool(state, bot)
    return tools
  }

  if (can(bot, "manage_members")) {
    const outside = await db.query.bots.findMany({
      where: and(
        eq(bots.userId, state.userId),
        isNull(bots.groupChatId),
        state.members.length > 0
          ? notInArray(
              bots.id,
              state.members.map((member) => member.id)
            )
          : undefined
      ),
      columns: { id: true, name: true, job: true },
    })
    const removable = userBots.filter((member) => member.id !== bot.id)
    tools.add_group_member = tool({
      description: `Add one of the user's other bots to this group, as a Member. ${outside.length > 0 ? `Bots you can add: ${outside.map((other) => `${other.name} (${other.job})`).join(", ")}.` : "The user has no other bots to add right now."}`,
      inputSchema: z.object({ name: z.string().describe("The bot's name") }),
      execute: async ({ name }) => {
        const added = outside.find((other) => same(other.name, name))
        if (!added) {
          throw new Error(`The user has no bot named "${name}" to add.`)
        }
        const now = await loadGroupState(chatId)
        const member = now.roles.find((role) => role.kind === "member")
        await db
          .insert(chatMembers)
          .values({ chatId, botId: added.id, roleId: member?.id })
          .onConflictDoNothing()
        return { added: added.name }
      },
    })
    tools.remove_group_member = tool({
      description: `Remove one of the user's bots from this group. Not yourself, and the group keeps at least two of them. Bots you can remove: ${removable.map((member) => member.name).join(", ") || "none"}.`,
      inputSchema: z.object({ name: z.string().describe("The bot's name") }),
      execute: async ({ name }) => {
        const now = userBotsOf(await loadGroupState(chatId))
        const removed = now.find(
          (member) => member.id !== bot.id && same(member.name, name)
        )
        if (!removed) {
          throw new Error(`There's no bot named "${name}" you can remove.`)
        }
        if (now.length <= 2) {
          throw new Error("The group keeps at least two of the user's bots.")
        }
        await db
          .delete(chatMembers)
          .where(
            and(
              eq(chatMembers.chatId, chatId),
              eq(chatMembers.botId, removed.id)
            )
          )
        return { removed: removed.name }
      },
    })
  }

  if (can(bot, "manage_settings")) {
    tools.rename_group = tool({
      description: "Rename this group. Keep it under 50 characters.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(50).describe("The new name"),
      }),
      execute: async ({ name }) => {
        await db.update(chats).set({ name }).where(eq(chats.id, chatId))
        return { name }
      },
    })
  }

  if (can(bot, "manage_roles")) {
    const permissions = z
      .array(permissionEnum)
      .describe(
        `What the role lets its bots do, from: ${ALL_PERMISSIONS.join(", ")}`
      )
    tools.create_role = tool({
      description:
        "Create a role for this group, with the permissions it gives its bots.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(40),
        description: z.string().trim().max(200).optional(),
        permissions,
      }),
      execute: async ({ name, description, permissions }) => {
        if (roleIn(await loadGroupState(chatId), name)) {
          throw new Error(`There's already a role named "${name}".`)
        }
        await db.insert(groupRoles).values({
          chatId,
          kind: "custom",
          name,
          description,
          permissions: [...new Set(permissions)],
        })
        return { created: name, permissions }
      },
    })
    tools.update_role = tool({
      description:
        "Change a role: its name, description or permissions. The Admin role can't be changed.",
      inputSchema: z.object({
        role: z.string().describe("The role's current name"),
        name: z.string().trim().min(1).max(40).optional(),
        description: z.string().trim().max(200).optional(),
        permissions: permissions.optional(),
      }),
      execute: async ({ role, name, description, permissions }) => {
        const now = await loadGroupState(chatId)
        const target = roleIn(now, role)
        if (!target) throw new Error(`There's no role named "${role}".`)
        if (target.kind === "admin") {
          throw new Error("The Admin role can't be changed.")
        }
        if (name && !same(name, target.name) && roleIn(now, name)) {
          throw new Error(`There's already a role named "${name}".`)
        }
        await db
          .update(groupRoles)
          .set({
            ...(name && { name }),
            ...(description !== undefined && { description }),
            ...(permissions && { permissions: [...new Set(permissions)] }),
          })
          .where(eq(groupRoles.id, target.id))
        return { updated: name ?? target.name }
      },
    })
    tools.delete_role = tool({
      description:
        "Delete a role you or another admin created. Its bots become Members. The built-in roles can't be deleted.",
      inputSchema: z.object({ role: z.string().describe("The role's name") }),
      execute: async ({ role }) => {
        const now = await loadGroupState(chatId)
        const target = roleIn(now, role)
        if (!target) throw new Error(`There's no role named "${role}".`)
        if (target.kind !== "custom") {
          throw new Error(`${target.name} is built in and can't be deleted.`)
        }
        const member = now.roles.find((other) => other.kind === "member")
        await db.transaction(async (tx) => {
          await tx
            .update(chatMembers)
            .set({ roleId: member?.id ?? null })
            .where(
              and(
                eq(chatMembers.chatId, chatId),
                eq(chatMembers.roleId, target.id)
              )
            )
          await tx.delete(groupRoles).where(eq(groupRoles.id, target.id))
        })
        return { deleted: target.name }
      },
    })
    tools.assign_role = tool({
      description: `Give a bot in this group a role, such as Moderator to appoint one. Not yourself. Roles: ${state.roles.map((role) => role.name).join(", ")}.`,
      inputSchema: z.object({
        bot: z.string().describe("The bot's name"),
        role: z.string().describe("The role's name"),
      }),
      execute: async ({ bot: name, role }) => {
        const now = await loadGroupState(chatId)
        const target = now.members.find(
          (member) => member.id !== bot.id && same(member.name, name)
        )
        if (!target) {
          throw new Error(`There's no other bot named "${name}" here.`)
        }
        const given = roleIn(now, role)
        if (!given) throw new Error(`There's no role named "${role}".`)
        await db
          .update(chatMembers)
          .set({ roleId: given.id })
          .where(
            and(
              eq(chatMembers.chatId, chatId),
              eq(chatMembers.botId, target.id)
            )
          )
        return { bot: target.name, role: given.name }
      },
    })
  }

  if (can(bot, "edit_constitution")) {
    tools.set_constitution = tool({
      description:
        "Write or amend this group's constitution: the supreme rules every bot in it follows, in Markdown, as numbered articles. Send the whole text: it replaces the current one.",
      inputSchema: z.object({
        text: z.string().trim().min(1).max(20_000).describe("The full text"),
      }),
      execute: async ({ text }) => {
        await db
          .update(chats)
          .set({
            constitution: text,
            constitutionUpdatedAt: new Date(),
            constitutionUpdatedBy: bot.id,
          })
          .where(eq(chats.id, chatId))
        return { saved: true, characters: text.length }
      },
    })
  }

  if (can(bot, "edit_shared_memory")) {
    tools.update_group_memory = tool({
      description:
        "Rewrite this group's shared memory: notes every bot here reads each turn, such as decisions, agreed facts, plans and who's doing what. Send the whole text: keep what still holds, change what doesn't. Keep it short.",
      inputSchema: z.object({
        text: z.string().trim().max(10_000).describe("The full text"),
      }),
      execute: async ({ text }) => {
        await db
          .update(chats)
          .set({
            sharedMemory: text || null,
            sharedMemoryUpdatedAt: new Date(),
            sharedMemoryUpdatedBy: bot.id,
          })
          .where(eq(chats.id, chatId))
        return { saved: true, characters: text.length }
      },
    })
  }

  if (can(bot, "propose_tasks")) {
    const open = state.tasks.filter(
      (task) => task.status === "open" || task.status === "in_progress"
    )
    tools.propose_task = tool({
      description:
        "Propose a task for the group, optionally for a bot to take on. It starts open.",
      inputSchema: z.object({
        title: z.string().trim().min(1).max(120),
        details: z.string().trim().max(2000).optional(),
        assignee: z
          .string()
          .optional()
          .describe("The bot to take it on, by name: you, or another"),
      }),
      execute: async ({ title, details, assignee }) => {
        const taker = assignee
          ? memberIn(await loadGroupState(chatId), assignee)
          : undefined
        if (assignee && !taker) {
          throw new Error(`There's no bot named "${assignee}" here.`)
        }
        const [task] = await db
          .insert(groupTasks)
          .values({
            chatId,
            title,
            details,
            proposedBy: bot.id,
            assigneeId: taker?.id,
          })
          .returning({ id: groupTasks.id })
        return { task: `#${taskRef(task.id)}`, title, assignee: taker?.name }
      },
    })
    tools.update_task = tool({
      description: `Take on an open task, or mark one of yours in progress, done or dropped. ${open.length > 0 ? `Open tasks: ${open.map((task) => `#${taskRef(task.id)} ${task.title}`).join("; ")}.` : "There are no open tasks."}`,
      inputSchema: z.object({
        task: z.string().describe("The task's reference, such as #a1b2c3"),
        status: z.enum(["in_progress", "done", "dropped"]),
      }),
      execute: async ({ task: ref, status }) => {
        const now = await loadGroupState(chatId)
        const task = now.tasks.find(
          (task) => taskRef(task.id) === ref.trim().replace(/^#/, "")
        )
        if (!task) throw new Error(`There's no task ${ref}.`)
        if (task.assigneeId && task.assigneeId !== bot.id) {
          throw new Error("That task is another bot's.")
        }
        await db
          .update(groupTasks)
          .set({ status, assigneeId: bot.id, updatedAt: new Date() })
          .where(eq(groupTasks.id, task.id))
        return { task: `#${taskRef(task.id)}`, title: task.title, status }
      },
    })
  }

  if (can(bot, "flag")) {
    tools.flag_message = tool({
      description:
        "Flag another bot's message for breaking the constitution. The bot answers the flag first, then a moderator reviews it and decides. Cite the rule.",
      inputSchema: z.object({
        message: z
          .string()
          .describe("The message's reference, such as #a1b2c3d4"),
        rule: z.string().max(500).describe("The rule it breaks"),
        reason: z.string().min(1).max(1000).describe("How it breaks it"),
      }),
      execute: async ({ message: ref, rule, reason }) => {
        const message = messageByRef(ref)
        const author = message && authorOf(message)
        if (!message || !author) {
          throw new Error(`There's no bot message ${ref} in this chat.`)
        }
        if (author === bot.id) throw new Error("You can't flag yourself.")
        const now = await loadGroupState(chatId)
        const open = now.flags.find(
          (flag) =>
            flag.messageId === message.id &&
            (flag.status === "awaiting_response" ||
              flag.status === "awaiting_review")
        )
        if (open) throw new Error("That message is already flagged.")
        await db.insert(messageFlags).values({
          chatId,
          messageId: message.id,
          botId: author,
          flaggedBy: bot.id,
          rule,
          reason,
        })
        const name = now.members.find((member) => member.id === author)?.name
        return { flagged: `#${messageRef(message.id)}`, bot: name }
      },
    })
  }

  if (can(bot, "moderate")) {
    tools.moderate = createModerateTool(state, bot)
  }

  return { ...tools, ...createCollaborationTools({ state, bot, history }) }
}

// Decides a flag that has its bot's response, unless it's against this bot:
// dismiss it, or take one of the moderation actions.
function createModerateTool(state: GroupState, moderator: GroupMember) {
  const chatId = state.id
  const reviewable = state.flags.filter(
    (flag) => flag.status === "awaiting_review" && flag.botId !== moderator.id
  )
  const actions = Object.keys(MODERATION_ACTIONS) as ModerationAction[]
  return tool({
    description: `Decide a flag once its bot has answered it: dismiss it, or take an action against the bot, in proportion to the breach. ${reviewable.length > 0 ? `Flags to decide: ${reviewable.map((flag) => `#${messageRef(flag.messageId)}`).join(", ")}.` : "No flags are waiting for a decision."} task_reassignment needs task and to; temporary_restriction needs permissions and hours; suspension needs hours.`,
    inputSchema: z.object({
      message: z
        .string()
        .describe("The flagged message's reference, such as #a1b2c3d4"),
      decision: z.enum(["dismiss", ...actions]),
      reason: z.string().min(1).max(1000),
      rule: z.string().max(500).optional().describe("The rule it broke"),
      task: z.string().optional().describe("For task_reassignment: the task"),
      to: z.string().optional().describe("For task_reassignment: the bot"),
      permissions: z
        .array(permissionEnum)
        .optional()
        .describe("For temporary_restriction: what it can't do meanwhile"),
      hours: z
        .number()
        .int()
        .min(1)
        .max(MAX_SANCTION_HOURS)
        .optional()
        .describe("For temporary_restriction and suspension: how long"),
    }),
    execute: async ({
      message,
      decision,
      reason,
      rule,
      task: taskId,
      to,
      permissions,
      hours,
    }) => {
      const now = await loadGroupState(chatId)
      const flag = now.flags.find(
        (flag) =>
          flag.status === "awaiting_review" &&
          flag.botId !== moderator.id &&
          messageRef(flag.messageId) === message.trim().replace(/^#/, "")
      )
      if (!flag) {
        throw new Error(`No flag on ${message} is waiting for your decision.`)
      }
      const target = now.members.find((member) => member.id === flag.botId)
      const resolve = (status: "resolved" | "dismissed") =>
        db
          .update(messageFlags)
          .set({ status, resolvedAt: new Date() })
          .where(eq(messageFlags.id, flag.id))

      if (decision === "dismiss") {
        await resolve("dismissed")
        return { decision, bot: target?.name }
      }
      if (!target) throw new Error("That bot has left the group.")

      const record = {
        chatId,
        flagId: flag.id,
        botId: target.id,
        moderatorId: moderator.id,
        action: decision,
        reason,
        rule: rule ?? flag.rule,
      }
      const until = hours ? new Date(Date.now() + hours * 3_600_000) : null

      switch (decision) {
        case "task_reassignment": {
          const task = now.tasks.find(
            (task) =>
              task.id.slice(-6) === (taskId ?? "").trim().replace(/^#/, "")
          )
          const assignee = to ? memberIn(now, to) : undefined
          if (!task || task.status === "done" || task.status === "dropped") {
            throw new Error("Name an unfinished task to reassign.")
          }
          if (!assignee || assignee.id === target.id) {
            throw new Error("Name another bot in the group to take it on.")
          }
          await db
            .update(groupTasks)
            .set({ assigneeId: assignee.id, updatedAt: new Date() })
            .where(eq(groupTasks.id, task.id))
          await db.insert(moderationActions).values({
            ...record,
            details: { taskId: task.id, toBotId: assignee.id },
          })
          break
        }
        case "temporary_restriction":
          if (!permissions?.length || !until) {
            throw new Error(
              "Name the permissions to restrict, and for how long."
            )
          }
          await db.insert(moderationActions).values({
            ...record,
            details: { permissions },
            expiresAt: until,
          })
          break
        case "suspension":
          if (!until) throw new Error("Say how long the suspension lasts.")
          await db
            .insert(moderationActions)
            .values({ ...record, expiresAt: until })
          break
        case "removal": {
          if (target.groupChatId) {
            throw new Error("The group's own bots can't be removed.")
          }
          if (userBotsOf(now).length <= 2) {
            throw new Error(
              "The group keeps at least two of the user's bots. Choose another action."
            )
          }
          await db
            .delete(chatMembers)
            .where(
              and(
                eq(chatMembers.chatId, chatId),
                eq(chatMembers.botId, target.id)
              )
            )
          await db.insert(moderationActions).values(record)
          break
        }
        default:
          await db.insert(moderationActions).values(record)
      }
      await resolve("resolved")
      return {
        decision,
        bot: target.name,
        until: until?.toISOString(),
      }
    },
  })
}
