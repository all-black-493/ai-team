"use client"

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react"
import { Maximize2Icon, MonitorIcon } from "lucide-react"

import { openChatDesktop } from "@/actions/chat"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

type Box = { x: number; y: number; width: number; height: number }
type Gesture = "move" | "resize-start" | "resize-end"
type Desktop =
  { status: "idle" | "loading" | "error" } | { status: "ready"; url: string }

// Room kept between the panel and the edges of the screen.
const MARGIN = 16
const MIN_WIDTH = 240
const MIN_HEIGHT = 180
// The bot's sandbox desktop is 1024x768, so the panel starts at 4:3.
const DEFAULT_WIDTH = 480

type DesktopBot = { id: string; name: string }

type DesktopPanelState = {
  bot: DesktopBot | undefined
  open: boolean
  fullscreen: boolean
  box: Box | null
  desktop: Desktop
  frameLoaded: boolean
  panelId: string
  // Where the desktop shows: the panel's body, or the full-screen dialog's.
  panelHost: RefObject<HTMLDivElement | null>
  dialogHost: RefObject<HTMLDivElement | null>
  toggle: (anchor: DOMRect) => void
  show: (botId: string) => void
  close: () => void
  setFullscreen: (fullscreen: boolean) => void
  setBox: (update: (box: Box) => Box) => void
  setGesturing: (gesturing: boolean) => void
  loadDesktop: () => void
}

const DesktopPanelContext = createContext<DesktopPanelState | null>(null)

// Shows a bot's desktop from outside the panel, such as when it starts
// using it. Null outside a chat with desktops.
export function useDesktop() {
  return useContext(DesktopPanelContext)
}

function useDesktopPanel() {
  const state = useContext(DesktopPanelContext)
  if (!state) {
    throw new Error("Desktop panel parts must be inside DesktopPanelProvider")
  }
  return state
}

// Keeps the whole panel on screen, no smaller than the minimum.
function clamp(box: Box): Box {
  const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - MARGIN * 2)
  const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - MARGIN * 2)
  const width = Math.min(Math.max(box.width, MIN_WIDTH), maxWidth)
  const height = Math.min(Math.max(box.height, MIN_HEIGHT), maxHeight)
  return {
    width,
    height,
    x: Math.min(Math.max(box.x, MARGIN), window.innerWidth - width - MARGIN),
    y: Math.min(Math.max(box.y, MARGIN), window.innerHeight - height - MARGIN),
  }
}

// Where a gesture that started at `box` puts the panel after moving by dx,
// dy. Resizing from the start (left) corner keeps the right edge in place.
function apply(box: Box, gesture: Gesture, dx: number, dy: number): Box {
  if (gesture === "move") {
    return clamp({ ...box, x: box.x + dx, y: box.y + dy })
  }
  const height = box.height + dy
  if (gesture === "resize-end") {
    return clamp({ ...box, width: box.width + dx, height })
  }
  const right = box.x + box.width
  const width = Math.min(Math.max(box.width - dx, MIN_WIDTH), right - MARGIN)
  return clamp({ ...box, x: right - width, width, height })
}

// Holds the panel's state for the header's toggle and the panel, and shows
// the bot's desktop (its Daytona sandbox, through noVNC). The desktop loads
// once, the first time the panel opens, and is kept: one iframe serves the
// panel and the full-screen dialog alike.
export function DesktopPanelProvider({
  chatId,
  bots,
  children,
}: {
  chatId: string
  // The chat's bots with a sandbox; the first is the panel's to begin with.
  bots: DesktopBot[]
  children: ReactNode
}) {
  const [botId, setBotId] = useState(bots[0]?.id)
  const bot = bots.find((other) => other.id === botId)
  const [open, setOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [box, setBoxState] = useState<Box | null>(null)
  const [desktop, setDesktop] = useState<Desktop>({ status: "idle" })
  const [frameLoaded, setFrameLoaded] = useState(false)
  const [gesturing, setGesturing] = useState(false)
  const panelHost = useRef<HTMLDivElement | null>(null)
  const dialogHost = useRef<HTMLDivElement | null>(null)
  const panelId = useId()

  async function loadDesktop(forBot = botId) {
    if (!forBot) return
    setDesktop({ status: "loading" })
    setFrameLoaded(false)
    try {
      setDesktop({
        status: "ready",
        url: await openChatDesktop(chatId, forBot),
      })
    } catch {
      setDesktop({ status: "error" })
    }
  }

  // The first time, top right of the screen, below `top`, so it stays in
  // reach of the header.
  function place(top: number) {
    if (box) return
    const width = Math.min(DEFAULT_WIDTH, window.innerWidth - MARGIN * 2)
    setBoxState(
      clamp({
        width,
        height: (width * 3) / 4,
        x: window.innerWidth - width - MARGIN,
        y: top,
      })
    )
  }

  const state: DesktopPanelState = {
    bot,
    open,
    fullscreen,
    box,
    desktop,
    frameLoaded,
    panelId,
    panelHost,
    dialogHost,
    toggle: (anchor) => {
      place(anchor.bottom + 8)
      if (!open && desktop.status === "idle") loadDesktop()
      setOpen(!open)
    },
    show: (next) => {
      if (!bots.some((other) => other.id === next)) return
      place(64)
      if (next !== botId || desktop.status === "idle") {
        setBotId(next)
        loadDesktop(next)
      }
      setOpen(true)
    },
    close: () => setOpen(false),
    setFullscreen,
    setBox: (update) => setBoxState((current) => current && update(current)),
    setGesturing,
    loadDesktop: () => loadDesktop(),
  }

  return (
    <DesktopPanelContext.Provider value={state}>
      {children}
      {desktop.status === "ready" && (
        <DesktopFrame
          url={desktop.url}
          gesturing={gesturing}
          onLoad={() => setFrameLoaded(true)}
        />
      )}
      <DesktopFullscreen />
    </DesktopPanelContext.Provider>
  )
}

export function DesktopPanelToggle({ className }: { className?: string }) {
  const state = useDesktop()
  if (!state) return null
  const { open, panelId, toggle } = state
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Desktop"
      aria-pressed={open}
      aria-controls={open ? panelId : undefined}
      onClick={(event) => toggle(event.currentTarget.getBoundingClientRect())}
      className={cn("aria-pressed:bg-muted", className)}
    >
      <MonitorIcon />
    </Button>
  )
}

// The one iframe. Moving an iframe in the DOM reloads it, so it never
// moves: it stays here and is laid over whichever host is showing, the
// panel's body or the dialog's, every frame. It takes mouse and keyboard in
// both; in the panel, a button on the preview offers full screen. (A cover
// over the whole preview would also block Daytona's preview warning, which
// has to be clicked through before the desktop shows.)
function DesktopFrame({
  url,
  gesturing,
  onLoad,
}: {
  url: string
  gesturing: boolean
  onLoad: () => void
}) {
  const { open, fullscreen, panelHost, dialogHost, setFullscreen } =
    useDesktopPanel()
  const layer = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let frame = 0
    const follow = () => {
      const element = layer.current
      const host = fullscreen
        ? dialogHost.current
        : open
          ? panelHost.current
          : null
      if (element) {
        if (host) {
          const rect = host.getBoundingClientRect()
          element.style.visibility = "visible"
          element.style.transform = `translate(${rect.left}px, ${rect.top}px)`
          element.style.width = `${rect.width}px`
          element.style.height = `${rect.height}px`
        } else {
          // Hidden, not removed: closing the panel keeps the session.
          element.style.visibility = "hidden"
        }
      }
      frame = requestAnimationFrame(follow)
    }
    frame = requestAnimationFrame(follow)
    return () => cancelAnimationFrame(frame)
  }, [open, fullscreen, panelHost, dialogHost])

  return (
    <div
      ref={layer}
      // Just above the panel (z-40), or above the full-screen dialog (z-50).
      // Other dialogs still open over the panel's preview.
      className={cn(
        "invisible fixed top-0 left-0 overflow-hidden rounded-md",
        fullscreen ? "z-[51]" : "z-[41]",
        // Dragging or resizing the panel over the iframe would hand the
        // pointer to the desktop.
        gesturing && "pointer-events-none"
      )}
    >
      <iframe
        src={url}
        title="Bot desktop"
        allow="clipboard-read; clipboard-write"
        onLoad={onLoad}
        className="size-full border-0"
      />
      {!fullscreen && (
        // Always shown: hover can't be told apart over a cross-origin iframe.
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Full screen"
          onClick={() => setFullscreen(true)}
          className="absolute top-2 right-2 shadow-lg"
        >
          <Maximize2Icon />
        </Button>
      )}
    </div>
  )
}

// Full screen through the dialog. Only its close button closes it: Escape,
// clicks outside and focus moving into the desktop all go to the desktop
// instead. Not modal, so the page doesn't go inert around the desktop's
// iframe, which sits outside the dialog.
function DesktopFullscreen() {
  const { fullscreen, setFullscreen, dialogHost } = useDesktopPanel()
  return (
    <Dialog
      open={fullscreen}
      modal={false}
      disablePointerDismissal
      onOpenChange={(next, { reason }) => {
        if (!next && reason === "close-press") setFullscreen(false)
      }}
    >
      <DialogContent className="flex h-[calc(100svh-2rem)] max-w-[calc(100%-2rem)] flex-col sm:max-w-[calc(100%-2rem)]">
        <DialogHeader>
          <DialogTitle>Desktop</DialogTitle>
          <DialogDescription>
            Mouse and keyboard go to the desktop. Close it with the button.
          </DialogDescription>
        </DialogHeader>
        <div ref={dialogHost} className="min-h-0 flex-1 rounded-md bg-muted" />
      </DialogContent>
    </Dialog>
  )
}

// A floating window over the chat: drag it by its top bar, resize it from
// either bottom corner. It doesn't block the page behind it.
export function DesktopPanel() {
  const {
    bot,
    open,
    box,
    desktop,
    frameLoaded,
    panelId,
    panelHost,
    close,
    setBox,
    setGesturing,
    loadDesktop,
  } = useDesktopPanel()

  // A smaller window shouldn't leave the panel off screen.
  useEffect(() => {
    if (!open) return
    const onResize = () => setBox(clamp)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [open, setBox])

  if (!open || !box) return null

  function startGesture(event: PointerEvent<HTMLElement>, gesture: Gesture) {
    if (event.button !== 0 || !box) return
    event.preventDefault()
    const start = { x: event.clientX, y: event.clientY, box }
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    setGesturing(true)
    const onMove = (move: globalThis.PointerEvent) =>
      setBox(() =>
        apply(
          start.box,
          gesture,
          move.clientX - start.x,
          move.clientY - start.y
        )
      )
    const onEnd = () => {
      setGesturing(false)
      handle.removeEventListener("pointermove", onMove)
      handle.removeEventListener("pointerup", onEnd)
      handle.removeEventListener("pointercancel", onEnd)
    }
    handle.addEventListener("pointermove", onMove)
    handle.addEventListener("pointerup", onEnd)
    handle.addEventListener("pointercancel", onEnd)
  }

  // Arrow keys do the same, 16px a press, or 64px with Shift.
  function keyGesture(event: KeyboardEvent<HTMLElement>, gesture: Gesture) {
    const step = event.shiftKey ? 64 : 16
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const delta = deltas[event.key]
    if (!delta) return
    event.preventDefault()
    setBox((current) => apply(current, gesture, delta[0], delta[1]))
  }

  const corner =
    "absolute bottom-0 z-10 size-4 touch-none outline-none focus-visible:bg-ring/30"

  return (
    <section
      id={panelId}
      data-agent-desktop={bot?.id}
      aria-label={bot ? `${bot.name}'s desktop` : "Desktop"}
      onKeyDown={(event) => event.key === "Escape" && close()}
      className="fixed z-40 flex flex-col overflow-hidden rounded-lg border bg-card shadow-lg"
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label="Move the desktop panel"
        onPointerDown={(event) => startGesture(event, "move")}
        onKeyDown={(event) => keyGesture(event, "move")}
        className="relative flex h-7 shrink-0 cursor-grab touch-none items-center justify-center border-b outline-none select-none focus-visible:bg-muted active:cursor-grabbing"
      >
        {bot && (
          <span className="absolute left-2 font-mono text-xs text-accent-foreground">
            {bot.name}
          </span>
        )}
        <span className="h-1 w-8 rounded-full bg-border-medium" />
      </div>
      {/* The desktop's iframe is laid over this; until it has loaded, this
          says what's happening. */}
      <div
        ref={panelHost}
        className="flex min-h-0 flex-1 items-center justify-center p-1 text-sm text-muted-foreground"
      >
        {desktop.status === "error" ? (
          <div className="flex flex-col items-center gap-2">
            Couldn&apos;t start the desktop.
            <Button variant="outline" size="sm" onClick={loadDesktop}>
              Try again
            </Button>
          </div>
        ) : (
          !frameLoaded && (
            <span className="flex items-center gap-2">
              <Spinner />
              Starting the desktop…
            </span>
          )
        )}
      </div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Resize the desktop panel from its left corner"
        onPointerDown={(event) => startGesture(event, "resize-start")}
        onKeyDown={(event) => keyGesture(event, "resize-start")}
        className={cn(corner, "left-0 cursor-nesw-resize")}
      />
      <div
        role="button"
        tabIndex={0}
        aria-label="Resize the desktop panel from its right corner"
        onPointerDown={(event) => startGesture(event, "resize-end")}
        onKeyDown={(event) => keyGesture(event, "resize-end")}
        className={cn(corner, "right-0 cursor-nwse-resize")}
      />
    </section>
  )
}
