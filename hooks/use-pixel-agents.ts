"use client"

import { useSyncExternalStore } from "react"

const KEY = "pixel-agents"
const EVENT = "pixel-agents-change"

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback)
  window.addEventListener(EVENT, callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(EVENT, callback)
  }
}

function read() {
  try {
    return localStorage.getItem(KEY) !== "off"
  } catch {
    return true
  }
}

// Whether the chat shows its bots as walking characters, remembered per
// browser.
export function usePixelAgents() {
  const on = useSyncExternalStore(subscribe, read, () => false)
  const set = (next: boolean) => {
    try {
      localStorage.setItem(KEY, next ? "on" : "off")
    } catch {}
    window.dispatchEvent(new Event(EVENT))
  }
  return [on, set] as const
}
