import { strFromU8, unzipSync } from "fflate"
import mammoth from "mammoth"
import { extractText, getDocumentProxy } from "unpdf"

import { CODE_EXTENSIONS, extensionOf, TEXT_EXTENSIONS } from "@/lib/knowledge"

type Section = { label: string; text: string; lines?: boolean }
export type Chunk = { section: string; content: string }

const TARGET_CHARS = 1500
const MAX_CHARS = 2200
const MAX_LINES = 60
const OVERLAP_LINES = 4
const MAX_CHUNKS = 4000
const MAX_FILE_BYTES = 300_000

const SKIPPED_DIRS =
  /(^|\/)(node_modules|\.git|dist|build|out|vendor|\.next|coverage|__pycache__|target|\.venv|venv|\.idea|\.vscode)\//
const SKIPPED_FILES =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|Gemfile\.lock|composer\.lock|go\.sum)$|\.min\.(js|css)$|\.map$/

const isBinary = (text: string) => text.includes("\u0000")

function decodeEntities(text: string) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(parseInt(code, 16))
    )
    .replace(/&amp;/g, "&")
}

const stripTags = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, ""))

function htmlToMarkdown(html: string) {
  return decodeEntities(
    html
      .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(
        /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
        (_, level, inner) =>
          `\n\n${"#".repeat(Number(level))} ${stripTags(inner).trim()}\n\n`
      )
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/(td|th)>/gi, " | ")
      .replace(/<\/(p|div|tr|table|ul|ol|blockquote|pre)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// Splits Markdown at its headings; each part is labelled with its heading
// path, such as "Setup › Install".
function markdownSections(text: string, prefix?: string): Section[] {
  const sections: Section[] = []
  const trail: string[] = []
  let buffer: string[] = []
  let fenced = false
  const label = () => {
    const path = trail.filter(Boolean).join(" › ")
    return [prefix, path].filter(Boolean).join(" § ") || "Introduction"
  }
  const flush = () => {
    const body = buffer.join("\n").trim()
    if (body) sections.push({ label: label(), text: body })
    buffer = []
  }
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    const heading = !fenced && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      flush()
      const level = heading[1].length
      trail.length = level - 1
      trail[level - 1] = heading[2].replace(/[*_`]/g, "").trim()
      continue
    }
    buffer.push(line)
  }
  flush()
  return sections
}

function splitLong(paragraph: string) {
  if (paragraph.length <= MAX_CHARS) return [paragraph]
  const sentences = paragraph.match(/[^.!?\n]+[.!?]*\s*/g) ?? [paragraph]
  const parts: string[] = []
  let current = ""
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > TARGET_CHARS) {
      parts.push(current.trim())
      current = ""
    }
    if (sentence.length > MAX_CHARS) {
      for (let i = 0; i < sentence.length; i += TARGET_CHARS) {
        parts.push(sentence.slice(i, i + TARGET_CHARS))
      }
      continue
    }
    current += sentence
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function proseChunks(section: Section): Chunk[] {
  const paragraphs = section.text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap(splitLong)
  const bodies: string[] = []
  let current: string[] = []
  let size = 0
  for (const paragraph of paragraphs) {
    if (size > 0 && size + paragraph.length > TARGET_CHARS) {
      bodies.push(current.join("\n\n"))
      const carried = current.at(-1)
      current = carried && carried.length < 300 ? [carried] : []
      size = current.reduce((total, part) => total + part.length, 0)
    }
    current.push(paragraph)
    size += paragraph.length
  }
  if (current.length > 0) bodies.push(current.join("\n\n"))
  return bodies.map((content, index) => ({
    section:
      bodies.length > 1
        ? `${section.label} (part ${index + 1})`
        : section.label,
    content,
  }))
}

function lineChunks(section: Section): Chunk[] {
  const lines = section.text.split("\n")
  const chunks: Chunk[] = []
  let start = 0
  while (start < lines.length) {
    let end = start
    let size = 0
    while (
      end < lines.length &&
      end - start < MAX_LINES &&
      size + lines[end].length < MAX_CHARS
    ) {
      size += lines[end].length + 1
      end++
    }
    if (end === start) end = start + 1
    const content = lines.slice(start, end).join("\n").slice(0, MAX_CHARS)
    if (content.trim()) {
      const range =
        lines.length <= MAX_LINES && start === 0
          ? ""
          : ` lines ${start + 1}–${end}`
      chunks.push({ section: `${section.label}${range}`.trim(), content })
    }
    if (end >= lines.length) break
    start = Math.max(end - OVERLAP_LINES, start + 1)
  }
  return chunks
}

function fileSections(path: string, text: string): Section[] {
  const ext = extensionOf(path)
  if (["md", "mdx", "markdown"].includes(ext)) {
    return markdownSections(text, path)
  }
  if (ext === "html" || ext === "htm") {
    return markdownSections(htmlToMarkdown(text), path)
  }
  return [{ label: path, text, lines: true }]
}

function repositorySections(bytes: Uint8Array) {
  const files = unzipSync(bytes, {
    filter: (file) =>
      !file.name.endsWith("/") &&
      file.originalSize <= MAX_FILE_BYTES &&
      !SKIPPED_DIRS.test(file.name) &&
      !SKIPPED_FILES.test(file.name) &&
      [...TEXT_EXTENSIONS, ...CODE_EXTENSIONS].includes(extensionOf(file.name)),
  })
  const names = Object.keys(files)
  // GitHub archives put everything in one top-level folder.
  const top = names[0]?.split("/")[0]
  const shared =
    top && names.length > 0 && names.every((name) => name.startsWith(`${top}/`))
  const priority = (path: string) =>
    /^readme/i.test(path) ? 0 : /^docs?\//i.test(path) ? 1 : 2
  return names
    .map((name) => ({
      path: shared ? name.slice(top.length + 1) : name,
      text: strFromU8(files[name]),
    }))
    .filter((file) => file.path && !isBinary(file.text) && file.text.trim())
    .toSorted(
      (a, b) =>
        priority(a.path) - priority(b.path) || a.path.localeCompare(b.path)
    )
    .flatMap((file) => fileSections(file.path, file.text))
}

async function sectionsOf(
  bytes: Uint8Array,
  fileName: string
): Promise<Section[]> {
  const ext = extensionOf(fileName)
  if (ext === "pdf") {
    const pdf = await getDocumentProxy(bytes)
    const { text } = await extractText(pdf, { mergePages: false })
    return text.map((page, index) => ({
      label: `Page ${index + 1}`,
      text: page.replace(/[ \t]+\n/g, "\n").trim(),
    }))
  }
  if (ext === "docx") {
    const { value } = await mammoth.convertToHtml({
      buffer: Buffer.from(bytes),
    })
    return markdownSections(htmlToMarkdown(value))
  }
  if (ext === "zip") return repositorySections(bytes)
  const text = new TextDecoder("utf-8").decode(bytes).replace(/\r\n?/g, "\n")
  if (isBinary(text)) throw new Error("This file isn't text.")
  if (["md", "mdx", "markdown"].includes(ext)) return markdownSections(text)
  if (ext === "html" || ext === "htm") {
    return markdownSections(htmlToMarkdown(text))
  }
  return [
    {
      label: CODE_EXTENSIONS.includes(ext) ? fileName : "",
      text,
      lines: true,
    },
  ]
}

// A file's text in passages small enough to embed, each with the section it
// came from: a heading path, a page, or a file and its lines.
export async function chunkFile(bytes: Uint8Array, fileName: string) {
  const sections = (await sectionsOf(bytes, fileName)).filter((section) =>
    section.text.trim()
  )
  const chunks: Chunk[] = []
  let truncated = false
  for (const section of sections) {
    const parts = section.lines ? lineChunks(section) : proseChunks(section)
    for (const part of parts) {
      if (chunks.length >= MAX_CHUNKS) {
        truncated = true
        break
      }
      chunks.push({
        section: part.section || "Text",
        content: part.content,
      })
    }
  }
  return {
    chunks,
    sections: sections.length,
    characters: sections.reduce(
      (total, section) => total + section.text.length,
      0
    ),
    truncated,
  }
}
