import { notFound, redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

import { getGroupCollection } from "@/queries/knowledge"

export default async function Page({
  params,
}: {
  params: Promise<{ chatId: string }>
}) {
  await auth.protect()
  const { chatId } = await params
  const collection = await getGroupCollection(chatId)
  if (!collection) notFound()
  redirect(`/knowledge/${collection.id}`)
}
