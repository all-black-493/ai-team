import { get } from "@vercel/blob"

import { ownsVersion } from "@/queries/knowledge"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  const { versionId } = await params
  const version = await ownsVersion(versionId)
  if (!version?.pathname) return new Response("Not found", { status: 404 })
  const blob = await get(version.pathname, { access: "private" })
  if (!blob || blob.statusCode !== 200 || !blob.stream) {
    return new Response("Not found", { status: 404 })
  }
  return new Response(blob.stream, {
    headers: {
      "Content-Type": version.contentType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(version.fileName)}`,
      "Cache-Control": "private, no-store",
    },
  })
}
