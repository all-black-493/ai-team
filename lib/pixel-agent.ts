export const AGENT_ACTIONS = [
  "idle",
  "walk",
  "talk",
  "think",
  "work",
  "read",
  "wave",
  "celebrate",
  "point",
  "alert",
  "sleep",
  "fail",
  "look",
  "yawn",
  "dance",
  "sit",
  "juggle",
  "kick",
  "highfive",
  "chat",
  "laugh",
  "held",
  "smile",
  "watch",
  "clap",
] as const

export type AgentAction = (typeof AGENT_ACTIONS)[number]

export const HATS = ["cap", "beanie", "antenna", "headphones", "bow"] as const

export type Hat = (typeof HATS)[number]

export type AgentLook = {
  skin: string
  hair: string
  shirt: string
  pants: string
  accent: string
  gear: string
  hat: Hat | null
  glasses: boolean
  longHair: boolean
}

const SKIN = ["F6D2B5", "F2C29B", "E0A980", "C68B62", "A0694A", "7A4E35"]
const HAIR = [
  "2A2320",
  "5A3A2B",
  "8B5A2B",
  "B4533B",
  "E8C547",
  "9AA3AD",
  "3E7CB1",
  "C86AA6",
]
const SHIRT = [
  "3E7CB1",
  "2E9E5B",
  "E0573C",
  "8E5BC9",
  "EE8FB0",
  "F4A62A",
  "2BA3A8",
  "4F6B3A",
  "34405A",
]
const PANTS = ["34405A", "6E7885", "3D302B", "2F4A3A", "4A3A5E"]
const ACCENT = ["F4C406", "FFFFFF", "E0573C", "5BB6F0", "2E9E5B"]
const GEAR = [
  "E0573C",
  "3E7CB1",
  "F4C406",
  "2E9E5B",
  "8E5BC9",
  "2A2320",
  "EE8FB0",
]

function random(seed: string) {
  let state = 2166136261
  for (let index = 0; index < seed.length; index++) {
    state = Math.imul(state ^ seed.charCodeAt(index), 16777619)
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

// The same seed always makes the same character.
export function lookOf(seed: string): AgentLook {
  const next = random(seed)
  const pick = <T>(list: readonly T[], except?: T) => {
    const options = list.filter((item) => item !== except)
    return options[Math.floor(next() * options.length)]
  }
  const shirt = pick(SHIRT)
  const hatRoll = next()
  return {
    skin: pick(SKIN),
    hair: pick(HAIR),
    shirt,
    pants: pick(PANTS, shirt),
    accent: pick(ACCENT, shirt),
    gear: pick(GEAR, shirt),
    hat: hatRoll < 0.3 ? null : HATS[Math.floor(next() * HATS.length)],
    glasses: next() < 0.25,
    longHair: next() < 0.35,
  }
}

const READING = new Set([
  "search_knowledge",
  "recall",
  "memory_history",
  "read_file",
  "list_files",
  "find_files",
  "search_text",
  "view_image",
  "code_symbols",
])
const THINKING = new Set([
  "remember",
  "forget",
  "propose_task",
  "update_task",
  "update_group_memory",
  "set_constitution",
])
const TALKING = new Set(["consult", "delegate", "call_vote", "answer_flag"])
const POINTING = new Set(["handoff", "flag_message", "moderate"])

// What a bot looks like it's doing while it runs a tool.
export function actionForTool(name: string): AgentAction {
  if (READING.has(name)) return "read"
  if (THINKING.has(name)) return "think"
  if (TALKING.has(name)) return "talk"
  if (POINTING.has(name)) return "point"
  return "work"
}
