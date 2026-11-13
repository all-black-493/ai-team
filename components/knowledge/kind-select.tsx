"use client"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  KNOWLEDGE_KIND_LABELS,
  KNOWLEDGE_KINDS,
  type KnowledgeKind,
} from "@/lib/knowledge"

const items = KNOWLEDGE_KINDS.map((kind) => ({
  value: kind,
  label: KNOWLEDGE_KIND_LABELS[kind],
}))

export function KindSelect({
  id,
  value,
  onChange,
  invalid,
}: {
  id?: string
  value: KnowledgeKind | null | undefined
  onChange: (kind: KnowledgeKind) => void
  invalid?: boolean
}) {
  return (
    <Select
      items={items}
      value={value ?? "document"}
      onValueChange={(next) => onChange(next as KnowledgeKind)}
    >
      <SelectTrigger id={id} aria-invalid={invalid} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
