import Link from "next/link"
import { notFound } from "next/navigation"
import { auth } from "@clerk/nextjs/server"
import { SettingsIcon } from "lucide-react"

import { AutoRefresh } from "@/components/knowledge/auto-refresh"
import { BotAccess } from "@/components/knowledge/bot-access"
import { CollectionDialog } from "@/components/knowledge/collection-dialog"
import { DeleteCollection } from "@/components/knowledge/delete-collection"
import { DocumentsTable } from "@/components/knowledge/documents-table"
import { IssuesList } from "@/components/knowledge/issues-list"
import { KnowledgeSearch } from "@/components/knowledge/knowledge-search"
import { NoteDialog } from "@/components/knowledge/note-dialog"
import { RepositoryDialog } from "@/components/knowledge/repository-dialog"
import { UploadButton } from "@/components/knowledge/upload-button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getCollection } from "@/queries/knowledge"

export default async function Page({
  params,
}: {
  params: Promise<{ collectionId: string }>
}) {
  await auth.protect()
  const { collectionId } = await params
  const collection = await getCollection(collectionId)
  if (!collection) notFound()
  const processing = collection.documents.some(
    (document) => document.latestStatus === "processing"
  )
  const group = Boolean(collection.groupChatId)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <AutoRefresh active={processing} />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/knowledge" />}>
              Knowledge
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{collection.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-heading">{collection.name}</h1>
            {group && <Badge variant="secondary">Group</Badge>}
          </div>
          {collection.description && (
            <p className="text-muted-foreground">{collection.description}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <UploadButton collectionId={collection.id} variant="default" />
          <NoteDialog collectionId={collection.id} />
          <RepositoryDialog collectionId={collection.id} />
          <CollectionDialog
            collection={collection}
            trigger={
              <Button variant="outline" aria-label="Collection settings">
                <SettingsIcon />
              </Button>
            }
          />
          <DeleteCollection id={collection.id} name={collection.name} />
        </div>
      </div>
      <Tabs defaultValue="documents">
        <TabsList>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="issues">
            Issues
            {collection.issues.length > 0 && (
              <Badge variant="secondary">{collection.issues.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="access">Access</TabsTrigger>
        </TabsList>
        <TabsContent value="documents" className="pt-4">
          <DocumentsTable
            collectionId={collection.id}
            documents={collection.documents}
          />
        </TabsContent>
        <TabsContent value="search" className="pt-4">
          <KnowledgeSearch collectionId={collection.id} />
        </TabsContent>
        <TabsContent value="issues" className="pt-4">
          <IssuesList collectionId={collection.id} issues={collection.issues} />
        </TabsContent>
        <TabsContent value="access" className="flex flex-col gap-3 pt-4">
          {group ? (
            <>
              <p className="text-sm text-muted-foreground">
                Every bot in {collection.group ?? "the group"} reads this
                collection when it answers there.
              </p>
              <BotAccess
                collectionId={collection.id}
                bots={collection.members}
                editable={false}
              />
            </>
          ) : collection.bots.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>No bots yet</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <BotAccess
              collectionId={collection.id}
              bots={collection.bots}
              editable
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
