import { Badge } from "@/components/ui/badge"
import type { RoleKind } from "@/lib/governance"
import { cn } from "@/lib/utils"

// How each kind of role stands out: Admin most, then Moderator.
const variants = {
  admin: "default",
  moderator: "secondary",
  member: "outline",
  custom: "outline",
} as const

// A bot's role in a group, as a small badge beside its name. `plain` keeps
// it outlined, for rows that color their text when highlighted, as in a menu.
export function RoleBadge({
  kind,
  name,
  plain,
  className,
}: {
  kind: RoleKind
  name: string
  plain?: boolean
  className?: string
}) {
  return (
    <Badge
      variant={plain ? "outline" : variants[kind]}
      className={cn("h-4 px-1.5 text-[10px] leading-none", className)}
    >
      {name}
    </Badge>
  )
}

// That a bot is suspended from its group, beside its name.
export function SuspendedBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="destructive"
      className={cn("h-4 px-1.5 text-[10px] leading-none", className)}
    >
      Suspended
    </Badge>
  )
}
