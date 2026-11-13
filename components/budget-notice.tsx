"use client"

import { GaugeIcon } from "lucide-react"

import { SettingsDialog } from "@/components/settings-dialog"
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import type { ChatBudget } from "@/chats/queries"
import { describeScope, type Limits } from "@/lib/budget"

export function BudgetNotice({
  budget,
  settings,
}: {
  budget: ChatBudget
  settings: Promise<Limits | null>
}) {
  const tightest = budget.scopes[0]
  return (
    <Alert variant={budget.exhausted ? "destructive" : "default"}>
      <GaugeIcon />
      <AlertTitle>
        {budget.exhausted
          ? "Spend limit reached"
          : `${Math.floor(tightest.used * 100)}% of a spend limit used`}
      </AlertTitle>
      <AlertDescription>
        {describeScope(tightest)}
        {budget.exhausted && ". Bots don't run until you raise it."}
      </AlertDescription>
      <AlertAction>
        <SettingsDialog
          settings={settings}
          trigger={
            <Button variant="outline" size="sm">
              Change limits
            </Button>
          }
        />
      </AlertAction>
    </Alert>
  )
}
