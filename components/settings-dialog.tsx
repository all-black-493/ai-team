"use client"

import { Suspense, use, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm, type Control } from "react-hook-form"

import { updateSettings } from "@/actions/settings"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { userSettingsInsertSchema, type UserSettingsInsert } from "@/db/schema"
import { APPROVAL_KINDS, type ApprovalKind, type Limits } from "@/lib/budget"

type SettingsDialogProps = {
  settings: Promise<Limits | null>
  trigger?: React.ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function SettingsDialog({
  settings,
  trigger,
  open,
  onOpenChange,
}: SettingsDialogProps) {
  const [ownOpen, setOwnOpen] = useState(false)
  const controlled = open !== undefined
  const isOpen = controlled ? open : ownOpen

  function setOpen(next: boolean) {
    if (!controlled) setOwnOpen(next)
    onOpenChange?.(next)
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {!controlled && trigger && <DialogTrigger render={trigger} />}
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Limits and approvals</DialogTitle>
          <DialogDescription>
            Bots stop at a limit until you raise it.
          </DialogDescription>
        </DialogHeader>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <SettingsForm settings={settings} onSaved={() => setOpen(false)} />
        </Suspense>
      </DialogContent>
    </Dialog>
  )
}

function SettingsForm({
  settings,
  onSaved,
}: {
  settings: Promise<Limits | null>
  onSaved: () => void
}) {
  const current = use(settings)
  const form = useForm<UserSettingsInsert>({
    resolver: zodResolver(userSettingsInsertSchema),
    defaultValues: current ?? undefined,
  })

  async function onSubmit(values: UserSettingsInsert) {
    try {
      await updateSettings(values)
      toast.add({
        title: "Limits saved",
        description: "They apply from each bot's next turn.",
        type: "success",
      })
      onSaved()
    } catch {
      toast.add({
        title: "Couldn't save your limits",
        description: "Something went wrong. Please try again.",
        type: "error",
      })
    }
  }

  const isSubmitting = form.formState.isSubmitting

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-6"
    >
      <FieldGroup>
        <FieldSet>
          <FieldLegend>Spend (US dollars)</FieldLegend>
          <FieldDescription>Leave empty for no limit.</FieldDescription>
          <FieldGroup className="grid gap-4 sm:grid-cols-3">
            <NumberField
              control={form.control}
              name="chatSpendLimit"
              label="Per chat"
              step={0.01}
              nullable
            />
            <NumberField
              control={form.control}
              name="dailySpendLimit"
              label="Per day"
              step={0.01}
              nullable
            />
            <NumberField
              control={form.control}
              name="userSpendLimit"
              label="In total"
              step={0.01}
              nullable
            />
          </FieldGroup>
          <NumberField
            control={form.control}
            name="warnAtPercent"
            label="Warn at (%)"
          />
        </FieldSet>
        <FieldSet>
          <FieldLegend>Each bot, per turn</FieldLegend>
          <FieldGroup className="grid gap-4 sm:grid-cols-3">
            <NumberField
              control={form.control}
              name="maxTaskMinutes"
              label="Minutes"
            />
            <NumberField
              control={form.control}
              name="maxToolCalls"
              label="Tool calls"
            />
            <NumberField
              control={form.control}
              name="maxShellCommands"
              label="Shell commands"
            />
          </FieldGroup>
        </FieldSet>
        <FieldSet>
          <FieldLegend>Context</FieldLegend>
          <NumberField
            control={form.control}
            name="compactAfterTokens"
            label="Summarize older messages past (tokens)"
            step={1000}
            nullable
          />
          <FieldDescription>Leave empty to never summarize.</FieldDescription>
        </FieldSet>
        <FieldSet>
          <FieldLegend>Group chats</FieldLegend>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <NumberField
              control={form.control}
              name="maxAutopilotTurns"
              label="Autopilot turns in a row"
            />
            <NumberField
              control={form.control}
              name="maxParallelBots"
              label="Bots working at once"
            />
          </FieldGroup>
        </FieldSet>
        <FieldSet>
          <FieldLegend>Ask me before</FieldLegend>
          <FieldGroup className="gap-4">
            {(Object.keys(APPROVAL_KINDS) as ApprovalKind[]).map((kind) => (
              <Controller
                key={kind}
                name={kind}
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field
                    orientation="horizontal"
                    data-invalid={fieldState.invalid}
                  >
                    <FieldLabel htmlFor={`settings-${kind}`}>
                      {APPROVAL_KINDS[kind]}
                    </FieldLabel>
                    <Switch
                      id={`settings-${kind}`}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      aria-invalid={fieldState.invalid}
                    />
                  </Field>
                )}
              />
            ))}
          </FieldGroup>
        </FieldSet>
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}

type NumberName = {
  [K in keyof UserSettingsInsert]: UserSettingsInsert[K] extends number | null
    ? K
    : never
}[keyof UserSettingsInsert]

function NumberField({
  control,
  name,
  label,
  description,
  step = 1,
  nullable = false,
}: {
  control: Control<UserSettingsInsert>
  name: NumberName
  label: string
  description?: string
  step?: number
  nullable?: boolean
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`settings-${name}`}>{label}</FieldLabel>
          <Input
            id={`settings-${name}`}
            name={field.name}
            ref={field.ref}
            onBlur={field.onBlur}
            type="number"
            inputMode={step < 1 ? "decimal" : "numeric"}
            min={0}
            step={step}
            placeholder={nullable ? "No limit" : undefined}
            value={field.value ?? ""}
            onChange={(event) =>
              field.onChange(
                event.target.value === "" && nullable
                  ? null
                  : event.target.valueAsNumber
              )
            }
            aria-invalid={fieldState.invalid}
          />
          {description && <FieldDescription>{description}</FieldDescription>}
          {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  )
}
