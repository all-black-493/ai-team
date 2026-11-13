"use client"

import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { useRiveFile, type RiveFile } from "@rive-app/react-webgl2"

import {
  AGENT_FILE,
  AGENT_HEIGHT,
  AGENT_WIDTH,
  PixelAgent,
} from "@/components/pixel-agent"
import { lookOf, type AgentAction } from "@/lib/pixel-agent"

export type AgentTarget = "floor" | "message" | "approval" | "desktop"

export type StageActor = {
  id: string
  name: string
  seed: string
  action: AgentAction
  target: AgentTarget
}

type Point = { x: number; y: number }

type Behavior = {
  start: number
  until: number
  offset?: number
  face?: 1 | -1
  act: (elapsed: number) => AgentAction
}

type Catch = { players: [string, string]; start: number; until: number }

type Shared = {
  positions: Map<string, Point>
  behaviors: Map<string, Behavior>
  cursor: Point | null
  typingUntil: number
  dragging: number
}

const SPEED = 150
const SLOT = 64
const CEILING = 64
const SLEEP_AFTER = 90_000
const GRAVITY = 1800
const PASS = 1100

function lastOf(selector: string) {
  const all = document.querySelectorAll<HTMLElement>(selector)
  return all.item(all.length - 1) as HTMLElement | null
}

function floorSpot(slot: number, offset: number): Point | null {
  const floor = document.querySelector<HTMLElement>("[data-agent-floor]")
  if (!floor) return null
  const rect = floor.getBoundingClientRect()
  const x = rect.right - 52 - slot * SLOT + offset
  return { x: Math.max(rect.left + AGENT_WIDTH / 2, x), y: rect.top + 2 }
}

// Where a character stands for what it's doing: on the composer, on top of
// its answer, beside an approval it's waiting on, or on its desktop. A
// target out of view sends it back to the composer.
function spotFor(actor: StageActor, slot: number, offset: number) {
  const home = floorSpot(slot, offset)
  if (actor.target === "floor" || !home) return home
  const floorTop = home.y
  const selector =
    actor.target === "message"
      ? `[data-agent-message="${actor.id}"]`
      : actor.target === "approval"
        ? `[data-agent-message="${actor.id}"] [data-agent-approval]`
        : `[data-agent-desktop="${actor.id}"]`
  const element = lastOf(selector)
  if (!element) return home
  const rect = element.getBoundingClientRect()
  if (actor.target === "desktop") {
    return { x: rect.left + 40, y: rect.top + 2 }
  }
  const visible = rect.bottom > CEILING + 40 && rect.top < floorTop - 40
  if (!visible) return home
  const right = Math.min(rect.right, window.innerWidth) - AGENT_WIDTH / 2 - 4
  return {
    x: actor.target === "approval" ? right - 8 : right,
    y: Math.min(Math.max(rect.top + 4, CEILING + AGENT_HEIGHT), floorTop),
  }
}

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]

const highFiveAct = (elapsed: number): AgentAction =>
  elapsed < 500 ? "idle" : elapsed < 1800 ? "highfive" : "laugh"

function Walker({
  actor,
  slot,
  file,
  shared,
  drowsy,
  cheer,
  activeId,
  onPoke,
  onDragging,
}: {
  actor: StageActor
  slot: number
  file: RiveFile
  shared: RefObject<Shared>
  drowsy: boolean
  cheer: AgentAction | null
  activeId: string | undefined
  onPoke: () => void
  onDragging: (change: 1 | -1) => void
}) {
  const node = useRef<HTMLButtonElement>(null)
  const latest = useRef({ actor, cheer, drowsy, activeId })
  const position = useRef<Point | null>(null)
  const wander = useRef(0)
  const reaction = useRef<{ action: AgentAction; until: number } | null>(null)
  const hover = useRef(false)
  const press = useRef<Point | null>(null)
  const drag = useRef<{ dx: number; dy: number; pointer: Point } | null>(null)
  const fall = useRef<{ velocity: number; from: number } | null>(null)
  const dragged = useRef(false)
  const clicks = useRef<number[]>([])
  const [action, setAction] = useState<AgentAction>(actor.action)
  const [facing, setFacing] = useState<1 | -1>(-1)
  const look = useMemo(() => lookOf(actor.seed), [actor.seed])

  useEffect(() => {
    latest.current = { actor, cheer, drowsy, activeId }
  })

  useEffect(() => {
    let frame = 0
    let last = performance.now()
    let shown: AgentAction | null = null
    let faced: 1 | -1 = -1
    const still = window.matchMedia("(prefers-reduced-motion: reduce)")
    const tick = (time: number) => {
      const elapsed = Math.min((time - last) / 1000, 0.1)
      last = time
      const { actor: current, cheer, drowsy, activeId } = latest.current
      const element = node.current
      const behavior = shared.current.behaviors.get(current.id)
      const resting = current.target === "floor" && current.action === "idle"
      const acting =
        behavior !== undefined &&
        resting &&
        time >= behavior.start &&
        time < behavior.until
      const reacting =
        reaction.current !== null && time < reaction.current.until
      const offset = wander.current + (acting ? (behavior.offset ?? 0) : 0)
      const spot = spotFor(current, slot, offset)
      let face: 1 | -1 | null = null
      let walking = false
      let next = position.current ?? spot

      if (drag.current) {
        next = {
          x: drag.current.pointer.x + drag.current.dx,
          y: drag.current.pointer.y + drag.current.dy,
        }
      } else if (fall.current && next && spot) {
        fall.current.velocity += GRAVITY * elapsed
        const y = next.y + fall.current.velocity * elapsed
        if (still.matches || y >= spot.y) {
          const height = spot.y - fall.current.from
          reaction.current = {
            action: height > 220 ? "fail" : "laugh",
            until: time + (height > 220 ? 1800 : 1200),
          }
          fall.current = null
          next = { x: next.x, y: spot.y }
        } else {
          next = { x: next.x, y }
        }
      } else if (spot && next && !reacting && !cheer) {
        const dx = spot.x - next.x
        const dy = spot.y - next.y
        const distance = Math.hypot(dx, dy)
        const step = SPEED * elapsed
        const ride = distance < 24 && Math.abs(dx) < 4
        walking = !still.matches && !ride && distance > step
        next = walking
          ? {
              x: next.x + (dx / distance) * step,
              y: next.y + (dy / distance) * step,
            }
          : spot
        if (walking && Math.abs(dx) > 1) face = dx > 0 ? 1 : -1
      }

      if (next && element) {
        position.current = next
        shared.current.positions.set(current.id, next)
        element.style.transform = `translate(${Math.round(next.x - AGENT_WIDTH / 2)}px, ${Math.round(next.y - AGENT_HEIGHT)}px)`
        element.style.visibility = "visible"
      } else if (element) {
        element.style.visibility = "hidden"
      }

      let wanted: AgentAction
      if (drag.current || fall.current) wanted = "held"
      else if (reacting) wanted = reaction.current!.action
      else if (walking) wanted = "walk"
      else if (cheer) wanted = cheer
      else if (!resting) wanted = current.action
      else if (time < shared.current.typingUntil) wanted = "watch"
      else if (acting) {
        wanted = behavior.act(time - behavior.start)
        if (behavior.face) face = behavior.face
      } else if (hover.current) wanted = "smile"
      else if (drowsy) wanted = "sleep"
      else wanted = "idle"

      if (!walking && !face && resting && next) {
        const busyAt = activeId
          ? shared.current.positions.get(activeId)
          : undefined
        const cursor = shared.current.cursor
        const toward =
          busyAt && activeId !== current.id
            ? busyAt.x
            : cursor &&
                Math.abs(cursor.x - next.x) < 260 &&
                cursor.y > next.y - 320
              ? cursor.x
              : undefined
        if (toward !== undefined && Math.abs(toward - next.x) > 6) {
          face = toward > next.x ? 1 : -1
        }
      }
      if (wanted === "sleep") face = 1
      if (face && face !== faced) {
        faced = face
        setFacing(face)
      }
      if (wanted !== shown) {
        shown = wanted
        setAction(wanted)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [slot, shared])

  useEffect(() => {
    const timer = setInterval(
      () => {
        wander.current = Math.round((Math.random() - 0.5) * 36)
      },
      7000 + Math.random() * 7000
    )
    return () => clearInterval(timer)
  }, [])

  function react(next: AgentAction, ms: number) {
    reaction.current = { action: next, until: performance.now() + ms }
  }

  // One click waves, two jump for joy, a flurry tickles, and too many make
  // it dizzy.
  function onClick() {
    if (dragged.current) {
      dragged.current = false
      return
    }
    onPoke()
    const now = performance.now()
    clicks.current = [...clicks.current.filter((at) => now - at < 900), now]
    const count = clicks.current.length
    if (count >= 7) {
      clicks.current = []
      react("fail", 2000)
    } else if (count >= 4) react("laugh", 1500)
    else if (count === 2) react("celebrate", 1300)
    else react("wave", 1600)
  }

  return (
    <button
      ref={node}
      type="button"
      aria-label={actor.name}
      title={actor.name}
      onClick={onClick}
      onPointerEnter={() => {
        hover.current = true
      }}
      onPointerLeave={() => {
        hover.current = false
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        press.current = { x: event.clientX, y: event.clientY }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const start = press.current
        if (!start) return
        const pointer = { x: event.clientX, y: event.clientY }
        if (!drag.current) {
          if (Math.hypot(pointer.x - start.x, pointer.y - start.y) < 6) return
          const at = position.current ?? pointer
          drag.current = {
            dx: at.x - pointer.x,
            dy: at.y - pointer.y,
            pointer,
          }
          fall.current = null
          reaction.current = null
          onDragging(1)
          onPoke()
        }
        drag.current.pointer = pointer
      }}
      onPointerUp={() => {
        press.current = null
        if (!drag.current) return
        drag.current = null
        dragged.current = true
        onDragging(-1)
        fall.current = { velocity: 0, from: position.current?.y ?? 0 }
      }}
      onPointerCancel={() => {
        press.current = null
        if (drag.current) onDragging(-1)
        drag.current = null
      }}
      className="pointer-events-auto invisible absolute top-0 left-0 cursor-grab touch-none rounded-sm focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing"
      style={{ width: AGENT_WIDTH, height: AGENT_HEIGHT }}
    >
      <PixelAgent file={file} look={look} action={action} facing={facing} />
    </button>
  )
}

function Ball({ game, shared }: { game: Catch; shared: RefObject<Shared> }) {
  const node = useRef<SVGSVGElement>(null)
  useEffect(() => {
    let frame = 0
    const tick = (time: number) => {
      const element = node.current
      const [right, left] = game.players.map((id) =>
        shared.current.positions.get(id)
      )
      if (element && right && left && time >= game.start) {
        const elapsed = time - game.start
        const [from, to] =
          Math.floor(elapsed / PASS) % 2 === 0 ? [right, left] : [left, right]
        const t = Math.min((elapsed % PASS) / (PASS * 0.8), 1)
        const x = from.x + (to.x - from.x) * t
        const y = from.y + (to.y - from.y) * t - Math.sin(Math.PI * t) * 34 - 6
        element.style.transform = `translate(${Math.round(x - 6)}px, ${Math.round(y - 6)}px)`
        element.style.visibility = "visible"
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [game, shared])
  return (
    <svg
      ref={node}
      aria-hidden
      width={12}
      height={12}
      viewBox="0 0 6 6"
      shapeRendering="crispEdges"
      className="invisible absolute top-0 left-0"
    >
      <path
        d="M2 0h2v1H2zM1 1h1v1H1zM4 1h1v1H4zM0 2h1v2H0zM5 2h1v2H5zM1 4h1v1H1zM4 4h1v1H4zM2 5h2v1H2z"
        fill="#2A2320"
      />
      <path d="M2 1h2v1H2zM1 2h1v2H1zM4 2h1v2H4zM2 4h2v1H2z" fill="#FFFFFF" />
      <path d="M2 2h2v2H2z" fill="#E0573C" />
    </svg>
  )
}

const SOLO: [AgentAction | "wander", number][] = [
  ["look", 3400],
  ["yawn", 2200],
  ["sit", 9000],
  ["juggle", 5200],
  ["read", 6000],
  ["dance", 3200],
  ["wander", 6000],
]

// The chat's bots as 8-bit characters walking the page. They wait on the
// composer, climb onto their answers while they write them, stand by an
// approval they're waiting on, clap when one of them finishes, and fill the
// quiet with games, chats and naps. They answer the pointer too: hovered
// they smile, clicked they wave, and they can be picked up and dropped.
export function AgentStage({
  actors,
  busy,
  failed,
}: {
  actors: StageActor[]
  busy: boolean
  failed: boolean
}) {
  const { riveFile, status } = useRiveFile({ src: AGENT_FILE })
  const shared = useRef<Shared>({
    positions: new Map(),
    behaviors: new Map(),
    cursor: null,
    typingUntil: 0,
    dragging: 0,
  })
  const [drowsy, setDrowsy] = useState(false)
  const [poke, setPoke] = useState(0)
  const [game, setGame] = useState<Catch | null>(null)
  const [cheer, setCheer] = useState<{
    id: string
    action: AgentAction
  } | null>(null)
  const active = actors.find((actor) => actor.target !== "floor")?.id
  const lastActive = useRef<string | undefined>(undefined)
  const wasBusy = useRef(busy)
  const cast = useRef({ actors, busy, drowsy })
  const nextEvent = useRef(0)
  const highFive = useRef<{ id: string; until: number } | null>(null)

  useEffect(() => {
    cast.current = { actors, busy, drowsy }
  })

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      shared.current.cursor = { x: event.clientX, y: event.clientY }
    }
    const onType = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (target?.closest("[data-agent-floor]")) {
        shared.current.typingUntil = performance.now() + 1800
      }
    }
    window.addEventListener("pointermove", onMove)
    document.addEventListener("input", onType)
    return () => {
      window.removeEventListener("pointermove", onMove)
      document.removeEventListener("input", onType)
    }
  }, [shared])

  useEffect(() => {
    if (busy) {
      lastActive.current = active ?? lastActive.current
      wasBusy.current = true
      shared.current.behaviors.clear()
      const timer = setTimeout(() => {
        setDrowsy(false)
        setGame(null)
      }, 0)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(() => setDrowsy(true), SLEEP_AFTER)
    if (!wasBusy.current) return () => clearTimeout(timer)
    wasBusy.current = false
    const id = lastActive.current
    if (!id) return () => clearTimeout(timer)
    const now = performance.now()
    if (!failed) {
      for (const actor of cast.current.actors) {
        if (actor.id === id || actor.target !== "floor") continue
        shared.current.behaviors.set(actor.id, {
          start: now,
          until: now + 1500,
          act: () => "clap",
        })
      }
      highFive.current = { id, until: now + 10_000 }
    }
    const done = setTimeout(
      () => setCheer({ id, action: failed ? "fail" : "celebrate" }),
      0
    )
    const over = setTimeout(() => setCheer(null), failed ? 2400 : 1300)
    return () => {
      clearTimeout(timer)
      clearTimeout(done)
      clearTimeout(over)
    }
  }, [busy, active, failed, shared, poke])

  useEffect(() => {
    const timer = setInterval(() => {
      const now = performance.now()
      for (const [id, behavior] of shared.current.behaviors) {
        if (behavior.until <= now) shared.current.behaviors.delete(id)
      }
      setGame((current) => (current && current.until <= now ? null : current))
      const { actors, busy, drowsy } = cast.current
      if (busy || drowsy || shared.current.dragging > 0) return
      const free = actors
        .map((actor, slot) => ({ actor, slot }))
        .filter(
          ({ actor }) =>
            actor.target === "floor" &&
            actor.action === "idle" &&
            !shared.current.behaviors.has(actor.id)
        )
      const pairAt = (rightSlot: number): [string, string] | null => {
        const right = free.find((entry) => entry.slot === rightSlot)
        const left = free.find((entry) => entry.slot === rightSlot + 1)
        return right && left ? [right.actor.id, left.actor.id] : null
      }
      const together = (
        [right, left]: [string, string],
        start: number,
        until: number,
        gap: number,
        act: (side: number) => (elapsed: number) => AgentAction
      ) => {
        shared.current.behaviors.set(right, {
          start,
          until,
          offset: -gap,
          face: -1,
          act: act(0),
        })
        shared.current.behaviors.set(left, {
          start,
          until,
          offset: gap,
          face: 1,
          act: act(1),
        })
      }

      const owed = highFive.current
      if (owed) {
        const slot = actors.findIndex((actor) => actor.id === owed.id)
        const at = shared.current.positions.get(owed.id)
        const home = floorSpot(slot, 0)
        const back =
          at &&
          home &&
          Math.abs(at.x - home.x) < 40 &&
          Math.abs(at.y - home.y) < 8
        const players = back ? (pairAt(slot) ?? pairAt(slot - 1)) : null
        if (players) {
          together(players, now + 200, now + 2800, 18, () => highFiveAct)
          highFive.current = null
          nextEvent.current = now + 6000
          return
        }
        if (now > owed.until) highFive.current = null
        else return
      }

      if (now < nextEvent.current || free.length === 0) return
      nextEvent.current = now + 6000 + Math.random() * 7000
      const roll = Math.random()

      if (free.length >= 3 && roll < 0.1) {
        for (const { actor } of free) {
          shared.current.behaviors.set(actor.id, {
            start: now,
            until: now + 4200,
            offset: Math.round((Math.random() - 0.5) * 20),
            act: () => "dance",
          })
        }
        return
      }

      const pairs = free
        .map(({ slot }) => pairAt(slot))
        .filter((players) => players !== null)
      if (pairs.length > 0 && roll < 0.55) {
        const players = pick(pairs)
        const kind = Math.random()
        if (kind < 0.45) {
          together(
            players,
            now,
            now + 7200,
            10,
            (side) => (elapsed) =>
              Math.floor(elapsed / 1800) % 2 === side ? "chat" : "idle"
          )
        } else if (kind < 0.8) {
          const start = now + 800
          const until = start + PASS * 7
          together(
            players,
            start,
            until,
            -16,
            (side) => (elapsed) =>
              Math.floor(elapsed / PASS) % 2 === side && elapsed % PASS < 380
                ? "kick"
                : "idle"
          )
          setGame({ players, start, until })
        } else {
          together(players, now, now + 2600, 18, () => highFiveAct)
        }
        return
      }

      const { actor } = pick(free)
      const [kind, duration] = pick(SOLO)
      shared.current.behaviors.set(actor.id, {
        start: now,
        until: now + duration,
        offset: kind === "wander" ? Math.round((Math.random() - 0.5) * 120) : 0,
        act: () => (kind === "wander" ? "look" : kind),
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [shared])

  if (!riveFile || status !== "success") return null
  return (
    <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
      {actors.map((actor, slot) => (
        <Walker
          key={actor.id}
          actor={actor}
          slot={slot}
          file={riveFile}
          shared={shared}
          drowsy={drowsy}
          cheer={cheer?.id === actor.id ? cheer.action : null}
          activeId={busy ? active : undefined}
          onPoke={() => {
            setDrowsy(false)
            setPoke((count) => count + 1)
          }}
          onDragging={(change) => {
            shared.current.dragging += change
          }}
        />
      ))}
      {game && <Ball game={game} shared={shared} />}
    </div>
  )
}
