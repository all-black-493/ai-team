"use client"

import { useEffect, useRef } from "react"
import {
  Alignment,
  Fit,
  Layout,
  useRive,
  type RiveFile,
  type ViewModelInstance,
} from "@rive-app/react-webgl2"

import { HATS, type AgentAction, type AgentLook } from "@/lib/pixel-agent"
import { cn } from "@/lib/utils"

export const AGENT_FILE = "/rive/pixel-agents.riv"
export const AGENT_WIDTH = 52
export const AGENT_HEIGHT = 60

const COLORS = ["skin", "hair", "shirt", "pants", "accent", "gear"] as const

function paint(instance: ViewModelInstance, look: AgentLook) {
  for (const name of COLORS) {
    const hex = look[name]
    instance
      .color(name)
      ?.argb(
        255,
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16)
      )
  }
  for (const hat of HATS) {
    const value = instance.number(hat)
    if (value) value.value = look.hat === hat ? 1 : 0
  }
  const glasses = instance.number("glasses")
  if (glasses) glasses.value = look.glasses ? 1 : 0
  const longHair = instance.number("longHair")
  if (longHair) longHair.value = look.longHair ? 1 : 0
}

// One 8-bit character, drawn by the Rive file in public/rive, its colours
// and gear set before its first frame.
export function PixelAgent({
  file,
  look,
  action,
  facing = 1,
  className,
}: {
  file: RiveFile
  look: AgentLook
  action: AgentAction
  facing?: 1 | -1
  className?: string
}) {
  const instanceRef = useRef<ViewModelInstance | null>(null)
  const actionRef = useRef(action)
  const { RiveComponent } = useRive({
    riveFile: file,
    artboard: "Agent",
    stateMachine: "Agent",
    autoplay: true,
    autoBind: false,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.BottomCenter }),
    onRiveReady: (rive) => {
      const instance = rive.viewModelByName("Agent")?.defaultInstance()
      if (!instance) return
      paint(instance, look)
      const current = instance.enum("action")
      if (current) current.value = actionRef.current
      rive.setViewModelInstance(instance)
      rive.bind()
      instanceRef.current = instance
    },
  })

  useEffect(() => {
    actionRef.current = action
    const current = instanceRef.current?.enum("action")
    if (current) current.value = action
  }, [action])

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none", className)}
      style={{
        width: AGENT_WIDTH,
        height: AGENT_HEIGHT,
        transform: facing === -1 ? "scaleX(-1)" : undefined,
      }}
    >
      <RiveComponent className="size-full" />
    </div>
  )
}
