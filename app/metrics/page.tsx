import { auth } from "@clerk/nextjs/server"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCost } from "@/lib/budget"
import { getMetrics } from "@/queries/metrics"

const percent = (value: number | null) =>
  value === null ? "—" : `${Math.round(value * 1000) / 10}%`

const seconds = (ms: number | null | undefined) =>
  ms === null || ms === undefined || Number.isNaN(ms)
    ? "—"
    : `${(ms / 1000).toFixed(1)} s`

const tokens = (count: number | null | undefined) =>
  count === null || count === undefined || Number.isNaN(count)
    ? "—"
    : Math.round(count).toLocaleString("en-US")

function Stat({
  label,
  value,
  of,
}: {
  label: string
  value: string
  of?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex items-baseline gap-2">
        <span className="text-2xl font-medium tabular-nums">{value}</span>
        {of && <span className="text-sm text-muted-foreground">{of}</span>}
      </dd>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-6 sm:grid-cols-2">{children}</dl>
      </CardContent>
    </Card>
  )
}

export default async function Page() {
  await auth.protect()
  const metrics = await getMetrics()
  if (!metrics) return null
  const { autopilot, sandboxes, context, memory, knowledge } = metrics

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <h1 className="font-display text-heading">Last {metrics.days} days</h1>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Autopilot">
          <Stat
            label="Recovery rate"
            value={percent(autopilot.recoveryRate)}
            of={`${autopilot.interrupted} cut off`}
          />
          <Stat
            label="Duplicate turns"
            value={percent(autopilot.duplicateRate)}
            of={`of ${autopilot.turns} turns`}
          />
          <Stat
            label="Duplicates refused"
            value={autopilot.refusedDuplicates.toLocaleString("en-US")}
          />
          <Stat
            label="Turns on their own"
            value={autopilot.automaticTurns.toLocaleString("en-US")}
          />
        </Section>
        <Section title="Sandboxes">
          <Stat
            label="Cold start, median"
            value={seconds(sandboxes.startP50)}
            of={`${sandboxes.coldStarts} starts`}
          />
          <Stat label="Cold start, 95th" value={seconds(sandboxes.startP95)} />
          <Stat
            label="API errors"
            value={percent(sandboxes.errorRate)}
            of={`of ${sandboxes.calls} calls`}
          />
          <Stat
            label="Running cost, estimated"
            value={formatCost(sandboxes.cost)}
            of={`${sandboxes.runningHours.toFixed(1)} h`}
          />
        </Section>
        <Section title="Context">
          <Stat
            label="Input tokens a turn"
            value={tokens(context.full?.inputTokens)}
            of={`${context.full?.turns ?? 0} turns`}
          />
          <Stat
            label="Input tokens, summarized"
            value={tokens(context.compacted?.inputTokens)}
            of={`${context.compacted?.turns ?? 0} turns`}
          />
          <Stat
            label="First token, median"
            value={seconds(context.full?.firstTokenMs)}
          />
          <Stat
            label="First token, summarized"
            value={seconds(context.compacted?.firstTokenMs)}
            of={`${context.summaries} summaries`}
          />
        </Section>
        <Section title="Memory">
          <Stat
            label="Retrieval accuracy"
            value={percent(memory.accuracy)}
            of={`${memory.retrievals} lookups`}
          />
          <Stat
            label="Repeated questions"
            value={percent(memory.repeatedRate)}
            of={`of ${memory.asked} asked`}
          />
          <Stat label="Notes" value={memory.notes.toLocaleString("en-US")} />
        </Section>
        <Section title="Knowledge">
          <Stat
            label="Answers citing sources"
            value={percent(knowledge.citationRate)}
            of={`of ${knowledge.answers} with passages`}
          />
          <Stat
            label="Lookups with matches"
            value={percent(knowledge.hitRate)}
            of={`of ${knowledge.lookups} lookups`}
          />
          <Stat
            label="Retrieval time, median"
            value={seconds(knowledge.latencyMs)}
          />
          <Stat
            label="Documents"
            value={knowledge.documents.toLocaleString("en-US")}
            of={`${knowledge.passages.toLocaleString("en-US")} passages`}
          />
          <Stat
            label="Open issues"
            value={knowledge.openIssues.toLocaleString("en-US")}
          />
          <Stat
            label="Due for review"
            value={knowledge.stale.toLocaleString("en-US")}
          />
        </Section>
      </div>
    </main>
  )
}
