// Files go from the browser straight to a private Vercel Blob store, so
// Vercel's 4.5 MB request limit doesn't apply. 15 MB matches Arena.
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
export const MAX_ATTACHMENT_LABEL = "15 MB"

// Each chat's uploads live under their own prefix, so an upload token or an
// attach request for one chat can't touch another chat's files.
export function attachmentPrefix(chatId: string) {
  return `chats/${chatId}/`
}
