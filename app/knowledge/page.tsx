import Link from "next/link"
import { auth } from "@clerk/nextjs/server"
import { formatDistanceToNow } from "date-fns"
import { LibraryIcon } from "lucide-react"

import { CollectionDialog } from "@/components/knowledge/collection-dialog"
import { IssuesBadge } from "@/components/knowledge/knowledge-badges"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { getCollections } from "@/queries/knowledge"

export default async function Page() {
  await auth.protect()
  const collections = await getCollections()

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-heading">Knowledge</h1>
        {collections.length > 0 && <CollectionDialog />}
      </div>
      {collections.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LibraryIcon />
            </EmptyMedia>
            <EmptyTitle>No collections yet</EmptyTitle>
            <EmptyDescription>
              Collect documents, specs, code and notes, then choose which bots
              can read them.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <CollectionDialog />
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((collection) => (
            <Link
              key={collection.id}
              href={`/knowledge/${collection.id}`}
              className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Card className="h-full transition-colors hover:bg-muted/40">
                <CardHeader>
                  <CardTitle>{collection.name}</CardTitle>
                  {collection.description && (
                    <CardDescription className="line-clamp-2">
                      {collection.description}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="mt-auto flex flex-wrap items-center gap-2 text-muted-foreground">
                  {collection.groupChatId && (
                    <Badge variant="secondary">Group</Badge>
                  )}
                  <span>
                    {collection.documents}{" "}
                    {collection.documents === 1 ? "document" : "documents"}
                  </span>
                  {!collection.groupChatId && (
                    <span>
                      · {collection.bots}{" "}
                      {collection.bots === 1 ? "bot" : "bots"}
                    </span>
                  )}
                  <span>
                    ·{" "}
                    {formatDistanceToNow(collection.updatedAt, {
                      addSuffix: true,
                    })}
                  </span>
                  <IssuesBadge count={collection.issues} />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
