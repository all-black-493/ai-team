import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"

import { attachmentPrefix, MAX_ATTACHMENT_BYTES } from "@/chats/attachments"
import { getChat } from "@/chats/queries"

// Hands the browser a short-lived token to upload one chat attachment
// straight to the private Blob store, with BLOB_READ_WRITE_TOKEN. The file
// itself never passes through here.
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody
  try {
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, chatId) => {
        // getChat is scoped to the signed-in Clerk user: no session, or
        // someone else's chat, gets nothing.
        if (!chatId || !(await getChat(chatId))) {
          throw new Error("Not authorized")
        }
        if (
          !pathname.startsWith(attachmentPrefix(chatId)) ||
          pathname.includes("..")
        ) {
          throw new Error("Not authorized")
        }
        return {
          maximumSizeInBytes: MAX_ATTACHMENT_BYTES,
          validUntil: Date.now() + 10 * 60 * 1000,
          addRandomSuffix: true,
          allowOverwrite: false,
          // attachChatFile moves the file into the sandbox and deletes it;
          // this cleans up any it never got to.
          ttlDays: 1,
        }
      },
    })
    return Response.json(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed"
    return Response.json(
      { error: message },
      { status: message === "Not authorized" ? 401 : 400 }
    )
  }
}
