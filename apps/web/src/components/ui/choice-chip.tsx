"use client"

import { Toggle } from "@base-ui/react/toggle"
import { Check } from "lucide-react"
import { cn } from "cn"

interface Props {
  label: string
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
  className?: string
}

// SCRUM-123: a pill that is on or off (the Figma accessibility chips, and the One space / Several spaces choice). A chosen
// chip shows a tick and a filled background, so "on" is never colour alone.
function ChoiceChip({ label, pressed, onPressedChange, className }: Props) {
  return (
    <Toggle
      data-slot="choice-chip"
      pressed={pressed}
      onPressedChange={onPressedChange}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border border-border-strong bg-card px-3 text-sm font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-pressed:bg-highlight data-pressed:font-bold data-pressed:text-fg-primary",
        className
      )}
    >
      {pressed ? <Check aria-hidden="true" className="size-3.5" /> : null}
      {label}
    </Toggle>
  )
}

export { ChoiceChip }
