"use client"

import { useState } from "react"
import { CheckIcon } from "lucide-react"

import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector"
import {
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
} from "@/components/ai-elements/prompt-input"
import { ChatAvatar } from "@/components/chat-avatar"
import { InputGroupButton } from "@/components/ui/input-group"
import { getModel, MODELS, PROVIDER_NAMES } from "@/lib/models"

type PickerBot = { id: string; name: string; avatar: string }

function BotLabel({ bot }: { bot: PickerBot }) {
  return (
    <>
      <ChatAvatar seed={bot.avatar} className="size-4 rounded-sm" />
      <span className="truncate">{bot.name}</span>
    </>
  )
}

// In a group's composer: which bot answers the next message.
export function BotPicker({
  bots,
  value,
  onValueChange,
  disabled,
}: {
  bots: PickerBot[]
  value: string
  onValueChange: (botId: string) => void
  disabled?: boolean
}) {
  return (
    <PromptInputSelect
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange(next)
      }}
      disabled={disabled}
    >
      <PromptInputSelectTrigger
        size="sm"
        aria-label="Bot to answer"
        className="max-w-44"
      >
        <PromptInputSelectValue>
          {(botId: string) => {
            const bot = bots.find((candidate) => candidate.id === botId)
            return bot ? <BotLabel bot={bot} /> : "Pick a bot"
          }}
        </PromptInputSelectValue>
      </PromptInputSelectTrigger>
      <PromptInputSelectContent
        side="top"
        align="start"
        alignItemWithTrigger={false}
      >
        {bots.map((bot) => (
          <PromptInputSelectItem key={bot.id} value={bot.id}>
            <BotLabel bot={bot} />
          </PromptInputSelectItem>
        ))}
      </PromptInputSelectContent>
    </PromptInputSelect>
  )
}

const providers = [...new Set(MODELS.map((model) => model.provider))]

// The model a bot runs on, searchable by name: in its own chat, and in a
// group for the bot picked to answer. On phones it shows as the provider's
// logo, to leave the composer room.
export function ModelPicker({
  botName,
  value,
  onValueChange,
  disabled,
}: {
  botName: string
  value: string
  onValueChange: (modelId: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const current = getModel(value)

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger
        render={
          <InputGroupButton
            size="sm"
            variant="ghost"
            disabled={disabled}
            aria-label={`${botName}'s model: ${current.name}`}
            className="max-w-44 text-muted-foreground"
          />
        }
      >
        <ModelSelectorLogo provider={current.provider} />
        <span className="truncate max-sm:hidden">{current.name}</span>
      </ModelSelectorTrigger>
      {/* No close button: it sits over the search field, and Escape or a
          click outside closes the dialog. */}
      <ModelSelectorContent
        title={`Pick ${botName}'s model`}
        showCloseButton={false}
        className="sm:max-w-sm"
      >
        <ModelSelectorInput placeholder="Search models…" />
        <ModelSelectorList>
          <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
          {providers.map((provider) => (
            <ModelSelectorGroup
              key={provider}
              heading={PROVIDER_NAMES[provider]}
            >
              {MODELS.filter((model) => model.provider === provider).map(
                (model) => (
                  <ModelSelectorItem
                    key={model.id}
                    value={model.id}
                    keywords={[model.name, PROVIDER_NAMES[provider]]}
                    onSelect={() => {
                      setOpen(false)
                      if (model.id !== current.id) onValueChange(model.id)
                    }}
                  >
                    <ModelSelectorLogo provider={model.provider} />
                    <ModelSelectorName>{model.name}</ModelSelectorName>
                    {model.id === current.id ? (
                      <CheckIcon className="ml-auto" />
                    ) : (
                      <span className="ml-auto size-4" />
                    )}
                  </ModelSelectorItem>
                )
              )}
            </ModelSelectorGroup>
          ))}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  )
}
