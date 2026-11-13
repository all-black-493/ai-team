"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter()
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(timer)
  }, [active, router])
  return null
}
