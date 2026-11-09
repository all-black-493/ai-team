import Image from "next/image"
import { Avatar, Style } from "@dicebear/core"
import voxelArt from "@dicebear/styles/voxel-art.json" with { type: "json" }

import { cn } from "@/lib/utils"

const style = new Style(voxelArt)

type ChatAvatarProps = {
  seed: string
  // true animates all the time, "hover" only while the pointer is over it.
  animated?: boolean | "hover"
  className?: string
}

export function ChatAvatar({
  seed,
  animated = false,
  className,
}: ChatAvatarProps) {
  if (animated !== "hover") {
    // The animation is opt-in; without the tag DiceBear renders a still avatar.
    const src = new Avatar(style, {
      seed,
      ...(animated && { tags: ["animation"] }),
    }).toDataUri()

    // shrink-0: a face never squeezes in a flex row (e.g. the collapsed rail).
    return (
      <Image
        src={src}
        alt=""
        width={32}
        height={32}
        className={cn("shrink-0", className)}
      />
    )
  }

  // An SVG in an <img> can't see the pointer, so stack a still and an animated
  // copy and show the animated one on hover. The animated copy only adds
  // eyelids, so the swap doesn't move the character. "fastest" blinks every
  // 2.5s; slower speeds can go 8s without moving. motion-safe keeps the still
  // copy for reduced-motion users.
  const still = new Avatar(style, { seed }).toDataUri()
  const moving = new Avatar(style, {
    seed,
    animationVariant: "fastest",
  }).toDataUri()

  return (
    <span className="group/avatar inline-grid shrink-0">
      <Image
        src={still}
        alt=""
        width={32}
        height={32}
        className={cn(
          "col-start-1 row-start-1 motion-safe:group-hover/avatar:invisible",
          className
        )}
      />
      <Image
        src={moving}
        alt=""
        width={32}
        height={32}
        className={cn(
          "invisible col-start-1 row-start-1 motion-safe:group-hover/avatar:visible",
          className
        )}
      />
    </span>
  )
}
