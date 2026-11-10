import { z } from "zod"

// What a user sends to create a group chat. The dialog and createGroupChat
// both validate with it, so the limits and messages live here once.
export const groupChatSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the group a name.")
    .max(50, "Keep the name under 50 characters."),
  botIds: z
    .array(z.string().min(1))
    .min(2, "Pick at least two bots.")
    .refine((ids) => new Set(ids).size === ids.length, "Pick each bot once."),
})

export type GroupChatInput = z.infer<typeof groupChatSchema>
