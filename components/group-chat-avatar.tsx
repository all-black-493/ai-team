import { ChatAvatar } from "@/components/chat-avatar"
import { Avatar, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

type GroupMember = { name: string; avatar: string }

// Where each face sits in the square, by how many show: two side by side and
// overlapping, three in a triangle, four in a 2×2 grid.
const layouts = {
  1: ["inset-0"],
  2: [
    "top-1/2 left-0 size-[62%] -translate-y-1/2",
    "top-1/2 right-0 size-[62%] -translate-y-1/2",
  ],
  3: [
    "top-0 left-1/2 size-[54%] -translate-x-1/2",
    "bottom-0 left-0 size-[54%]",
    "right-0 bottom-0 size-[54%]",
  ],
  4: [
    "top-0 left-0 size-[48%]",
    "top-0 right-0 size-[48%]",
    "bottom-0 left-0 size-[48%]",
    "right-0 bottom-0 size-[48%]",
  ],
} as const

// A group chat's face: its bots' faces in one square the size of a single
// ChatAvatar (32px by default; className resizes both alike), so it takes
// the same room in the sidebar, the search and the chat header. Up to three
// faces show; the fourth spot counts the rest. Overlapping faces are parted
// by a ring in the page's fill; on another fill, set --face-ring to it.
export function GroupChatAvatar({
  members,
  className,
}: {
  members: GroupMember[]
  className?: string
}) {
  const shown = members.slice(0, 3)
  const count = members.length - shown.length
  const slots =
    layouts[Math.min(Math.max(members.length, 1), 4) as 1 | 2 | 3 | 4]

  return (
    // The names are in the chat's title; the faces are decoration. A
    // container, so the count's text scales with the square. A group whose
    // bots were all deleted keeps an empty tile in their place.
    <AvatarGroup
      aria-hidden
      className={cn(
        "@container relative block size-8 shrink-0 space-x-0 [--face-ring:var(--background)] *:data-[slot=avatar]:ring-[1.5px] *:data-[slot=avatar]:ring-(--face-ring)",
        members.length === 0 && "rounded-md bg-muted",
        className
      )}
    >
      {shown.map((member, index) => (
        <Avatar
          key={`${member.avatar}-${index}`}
          className={cn("absolute size-auto", slots[index])}
        >
          <ChatAvatar
            seed={member.avatar}
            className="size-full rounded-full object-cover"
          />
        </Avatar>
      ))}
      {count > 0 && (
        <AvatarGroupCount
          className={cn(
            "absolute text-[26cqw] font-medium tabular-nums ring-[1.5px] ring-(--face-ring)",
            slots[3]
          )}
        >
          +{count}
        </AvatarGroupCount>
      )}
    </AvatarGroup>
  )
}
