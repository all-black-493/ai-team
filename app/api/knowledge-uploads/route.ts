import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"

import {
  isAccepted,
  knowledgePrefix,
  MAX_KNOWLEDGE_BYTES,
} from "@/lib/knowledge"
import { ownsCollection } from "@/queries/knowledge"

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody
  try {
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, collectionId) => {
        if (!collectionId || !(await ownsCollection(collectionId))) {
          throw new Error("Not authorized")
        }
        if (
          !pathname.startsWith(knowledgePrefix(collectionId)) ||
          pathname.includes("..") ||
          !isAccepted(pathname)
        ) {
          throw new Error("Not authorized")
        }
        return {
          maximumSizeInBytes: MAX_KNOWLEDGE_BYTES,
          validUntil: Date.now() + 10 * 60 * 1000,
          addRandomSuffix: true,
          allowOverwrite: false,
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
