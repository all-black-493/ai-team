"use client"

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
} from "react"
import {
  ArrowRightIcon,
  FileIcon,
  FileTextIcon,
  PaperclipIcon,
  PlusIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"

import { SpeechInput } from "@/components/ai-elements/speech-input"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { toast } from "@/components/ui/toast"

export type ComposerMessage = { text: string; files: File[] }

type ChatComposerProps = {
  placeholder?: string
  // Without it, sending is off: the send button stays disabled. While it
  // runs, the message stays in the composer; it's cleared once it resolves,
  // and kept if it throws, so nothing is lost.
  onSend?: (message: ComposerMessage) => Promise<void> | void
  // Turns the send button into a stop button, while the bot is answering.
  onStop?: () => void
  // No typing at all, such as while the conversation is loading.
  disabled?: boolean
  // Shows the attach menu, for files up to this size.
  attachments?: { maxBytes: number; maxLabel: string }
  // More controls beside the attach menu, such as the token meter.
  toolbar?: ReactNode
  // A line above the text, such as the message being replied to.
  header?: ReactNode
  // The text box, to focus it from outside.
  inputRef?: Ref<HTMLTextAreaElement>
}

type PendingFile = { id: string; file: File; preview?: string }

// Dictation uses the browser's own speech recognition. Where there's none
// (Firefox), there's no mic. The server can't tell, so it renders none and
// the browser adds it after hydration.
const noSubscribe = () => () => {}
function useSpeechRecognition() {
  return useSyncExternalStore(
    noSubscribe,
    () => "SpeechRecognition" in window || "webkitSpeechRecognition" in window,
    () => false
  )
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// DESIGN.md's composer, measured on arena.ai: a surface fill and hairline
// border that darkens on focus (no ring), a 14px radius and 8px padding;
// 16/24 text with 12px padding, at least 80px and at most 40vh tall; and a
// 32px outlined send button with a 4px radius, at half opacity until there's
// text. Enter sends, Shift+Enter adds a line. Arena's "+" opens a menu with
// "Add files"; chosen files wait as chips above the text.
export function ChatComposer({
  placeholder = "Ask anything…",
  onSend,
  onStop,
  disabled,
  attachments,
  toolbar,
  header,
  inputRef,
}: ChatComposerProps) {
  const [message, setMessage] = useState("")
  const [files, setFiles] = useState<PendingFile[]>([])
  const [sending, setSending] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const canDictate = useSpeechRecognition()
  const canSend =
    onSend !== undefined &&
    !sending &&
    (message.trim().length > 0 || files.length > 0)

  // Image previews are object URLs, released when the composer goes away.
  const previews = useRef(new Set<string>())
  useEffect(() => {
    const urls = previews.current
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  function addFiles(list: FileList | null) {
    if (!list || !attachments) return
    const accepted: PendingFile[] = []
    for (const file of Array.from(list)) {
      if (file.size > attachments.maxBytes) {
        toast.add({
          title: `${file.name} is too large`,
          description: `Files can be up to ${attachments.maxLabel}.`,
          type: "error",
        })
        continue
      }
      const preview = file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined
      if (preview) previews.current.add(preview)
      accepted.push({ id: crypto.randomUUID(), file, preview })
    }
    setFiles((current) => [...current, ...accepted])
  }

  function removeFile(id: string) {
    setFiles((current) =>
      current.filter((item) => {
        if (item.id === id && item.preview) URL.revokeObjectURL(item.preview)
        return item.id !== id
      })
    )
  }

  async function send() {
    if (!canSend) return
    setSending(true)
    try {
      await onSend({
        text: message.trim(),
        files: files.map((item) => item.file),
      })
      files.forEach((item) => item.preview && URL.revokeObjectURL(item.preview))
      setMessage("")
      setFiles([])
    } catch {
      // onSend has said what went wrong; the message stays to try again.
    } finally {
      setSending(false)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
    >
      {attachments && (
        <input
          ref={fileInput}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            addFiles(event.target.files)
            event.target.value = ""
          }}
        />
      )}
      {/* InputGroup dims itself when anything inside is disabled; the
          has-disabled overrides keep the disabled send button from fading
          the whole composer. */}
      <InputGroup className="gap-2 rounded-[14px] border-border bg-card p-2 has-disabled:bg-card has-disabled:opacity-100 has-[[data-slot=input-group-control]:focus-visible]:border-border-medium has-[[data-slot=input-group-control]:focus-visible]:ring-0 dark:bg-card dark:has-disabled:bg-card">
        {header && (
          <InputGroupAddon align="block-start" className="p-1 pb-0">
            {header}
          </InputGroupAddon>
        )}
        {files.length > 0 && (
          <InputGroupAddon
            align="block-start"
            className="flex-wrap gap-2 p-1 pb-0"
          >
            {files.map(({ id, file, preview }) => (
              <Attachment
                key={id}
                size="sm"
                state={sending ? "uploading" : "done"}
              >
                <AttachmentMedia variant={preview ? "image" : "icon"}>
                  {preview ? (
                    // An object URL for a file still on this device, which
                    // next/image can't optimize.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt="" />
                  ) : file.type.startsWith("text/") ? (
                    <FileTextIcon />
                  ) : (
                    <FileIcon />
                  )}
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{file.name}</AttachmentTitle>
                  <AttachmentDescription>
                    {formatBytes(file.size)}
                  </AttachmentDescription>
                </AttachmentContent>
                {!sending && (
                  <AttachmentActions>
                    <AttachmentAction
                      aria-label={`Remove ${file.name}`}
                      onClick={() => removeFile(id)}
                    >
                      <XIcon />
                    </AttachmentAction>
                  </AttachmentActions>
                )}
              </Attachment>
            ))}
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          ref={inputRef}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
          onPaste={(event) => {
            if (event.clipboardData.files.length > 0) {
              event.preventDefault()
              addFiles(event.clipboardData.files)
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          aria-label="Message"
          className="max-h-[40vh] min-h-20 p-3 text-base md:text-base"
        />
        <InputGroupAddon align="block-end" className="p-0">
          {attachments && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <InputGroupButton
                    variant="secondary"
                    size="icon-sm"
                    aria-label="Add"
                    disabled={disabled || sending}
                    className="rounded-[4px]"
                  />
                }
              >
                <PlusIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" className="min-w-68">
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    className="gap-3"
                    onClick={() => fileInput.current?.click()}
                  >
                    <span className="flex flex-1 flex-col">
                      <span className="font-book">Add files</span>
                      <span className="text-xs text-muted-foreground">
                        Up to {attachments.maxLabel} per file
                      </span>
                    </span>
                    <PaperclipIcon />
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {toolbar}
          <div className="ml-auto flex items-center gap-1">
            {/* What's said is added to the text, to check before sending. */}
            {canDictate && onSend && !disabled && (
              <SpeechInput
                variant="ghost"
                size="icon-sm"
                aria-label="Dictate"
                className="text-muted-foreground"
                onTranscriptionChange={(text) =>
                  setMessage((current) =>
                    [current.trimEnd(), text.trim()].filter(Boolean).join(" ")
                  )
                }
              />
            )}
            {onStop ? (
              <InputGroupButton
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={onStop}
                aria-label="Stop"
                className="rounded-[4px] bg-transparent"
              >
                <SquareIcon className="fill-current" />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type="submit"
                variant="outline"
                size="icon-sm"
                disabled={!canSend}
                aria-label="Send message"
                className="rounded-[4px] bg-transparent"
              >
                <ArrowRightIcon />
              </InputGroupButton>
            )}
          </div>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
