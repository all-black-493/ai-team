export const KNOWLEDGE_KINDS = [
  "document",
  "specification",
  "code",
  "meeting-notes",
  "research",
  "policy",
] as const

export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number]

export const KNOWLEDGE_KIND_LABELS: Record<KnowledgeKind, string> = {
  document: "Document",
  specification: "Specification",
  code: "Code",
  "meeting-notes": "Meeting notes",
  research: "Research",
  policy: "Policy",
}

export const KNOWLEDGE_SOURCES = ["upload", "repository", "note"] as const

export const ISSUE_KINDS = ["conflict", "superseded", "duplicate"] as const
export type IssueKind = (typeof ISSUE_KINDS)[number]

export const ISSUE_LABELS: Record<IssueKind, string> = {
  conflict: "Conflict",
  superseded: "Superseded",
  duplicate: "Duplicate",
}

export const SEARCH_MODES = ["hybrid", "semantic", "keyword"] as const
export type SearchMode = (typeof SEARCH_MODES)[number]

export const EMBEDDING = {
  model: "qwen3-embedding-0-6b",
  dimensions: 1024,
  dollarsPerMillionTokens: 0.02,
} as const

export const MAX_KNOWLEDGE_BYTES = 50 * 1024 * 1024
export const DEFAULT_REVIEW_DAYS = 180

export const TEXT_EXTENSIONS = [
  "md",
  "mdx",
  "markdown",
  "txt",
  "text",
  "rst",
  "adoc",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
  "html",
  "htm",
  "ini",
  "log",
]

export const CODE_EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "swift",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "php",
  "scala",
  "sql",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "lua",
  "dart",
  "ex",
  "exs",
  "erl",
  "hs",
  "clj",
  "vue",
  "svelte",
  "astro",
  "css",
  "scss",
  "less",
  "graphql",
  "gql",
  "proto",
  "tf",
  "hcl",
  "prisma",
  "dockerfile",
  "makefile",
  "gradle",
  "r",
  "jl",
  "zig",
  "nim",
  "ml",
  "fs",
]

export const ACCEPTED_EXTENSIONS = [
  "pdf",
  "docx",
  "zip",
  ...TEXT_EXTENSIONS,
  ...CODE_EXTENSIONS,
]

export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.map(
  (ext) => `.${ext}`
).join(",")

export function extensionOf(fileName: string) {
  const base = fileName.split("/").pop()?.toLowerCase() ?? ""
  if (base === "dockerfile" || base === "makefile") return base
  const dot = base.lastIndexOf(".")
  return dot === -1 ? "" : base.slice(dot + 1)
}

export function isAccepted(fileName: string) {
  return ACCEPTED_EXTENSIONS.includes(extensionOf(fileName))
}

export function kindForFile(fileName: string): KnowledgeKind {
  const ext = extensionOf(fileName)
  if (ext === "zip" || CODE_EXTENSIONS.includes(ext)) return "code"
  return "document"
}

export function titleFromFileName(fileName: string) {
  const base = fileName.split("/").pop() ?? fileName
  const dot = base.lastIndexOf(".")
  const stem = dot > 0 ? base.slice(0, dot) : base
  const title = stem.replace(/[-_]+/g, " ").trim().slice(0, 120)
  return title ? title[0].toUpperCase() + title.slice(1) : "Untitled"
}

export const knowledgePrefix = (collectionId: string) =>
  `knowledge/${collectionId}/`

export function parseRepository(url: string) {
  const match = url
    .trim()
    .match(
      /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^?#]+))?\/?(?:[?#].*)?$/i
    )
  if (!match) return null
  return { owner: match[1], repo: match[2], ref: match[3] }
}

export function isStale(updatedAt: Date, reviewAfterDays: number) {
  return Date.now() - updatedAt.getTime() > reviewAfterDays * 86_400_000
}

export const CITATION = /\[(\d{1,3})\]/g
