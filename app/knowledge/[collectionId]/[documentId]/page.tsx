import Link from "next/link"
import { notFound } from "next/navigation"
import { auth } from "@clerk/nextjs/server"

import { AutoRefresh } from "@/components/knowledge/auto-refresh"
import { DocumentActions } from "@/components/knowledge/document-actions"
import { IssuesList } from "@/components/knowledge/issues-list"
import { KindBadge, StaleBadge } from "@/components/knowledge/knowledge-badges"
import { VersionsTable } from "@/components/knowledge/versions-table"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getDocument } from "@/queries/knowledge"

export default async function Page({
  params,
}: {
  params: Promise<{ collectionId: string; documentId: string }>
}) {
  await auth.protect()
  const { collectionId, documentId } = await params
  const document = await getDocument(collectionId, documentId)
  if (!document) notFound()
  const processing = document.versions.some(
    (version) => version.status === "processing"
  )

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
            <BreadcrumbLink
              render={<Link href={`/knowledge/${document.collection.id}`} />}
            >
              {document.collection.name}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{document.title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="font-display text-heading break-words">
            {document.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <KindBadge kind={document.kind} />
            {document.archived && <Badge variant="outline">Archived</Badge>}
            {document.stale && <StaleBadge />}
            {document.sourceUrl && (
              <a
                href={document.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                {document.sourceUrl.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>
        </div>
        <DocumentActions document={document} />
      </div>
      <Tabs defaultValue="passages">
        <TabsList>
          <TabsTrigger value="passages">Passages</TabsTrigger>
          <TabsTrigger value="versions">
            Versions
            <Badge variant="secondary">{document.versions.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="issues">
            Issues
            {document.issues.length > 0 && (
              <Badge variant="secondary">{document.issues.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="passages" className="pt-4">
          {document.passages.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>
                  {processing ? "Reading the file…" : "No passages"}
                </EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <ol className="flex flex-col gap-3">
              {document.passages.map((passage) => (
                <li
                  key={passage.id}
                  id={passage.id}
                  className="scroll-mt-6 rounded-lg border p-3 target:ring-2 target:ring-ring"
                >
                  <p className="mb-1 text-sm font-medium">{passage.section}</p>
                  <p className="line-clamp-6 text-sm whitespace-pre-wrap text-muted-foreground">
                    {passage.content}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
        <TabsContent value="versions" className="pt-4">
          <VersionsTable
            versions={document.versions}
            currentVersionId={document.currentVersionId}
          />
        </TabsContent>
        <TabsContent value="issues" className="pt-4">
          <IssuesList
            collectionId={document.collection.id}
            issues={document.issues}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
