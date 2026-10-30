"use client"

import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"
import { cn } from "cn"

// SCRUM-142: the shadcn radio group, on the theme tokens (input border 3:1, ring on focus). Wrap each Radio and its text in a
// <label> so the text names the radio and the whole row can be clicked.
function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return <RadioGroupPrimitive data-slot="radio-group" className={cn("flex flex-col gap-2", className)} {...props} />
}

function Radio({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-card outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:border-primary disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <RadioPrimitive.Indicator data-slot="radio-indicator" className="size-2 rounded-full bg-primary" />
    </RadioPrimitive.Root>
  )
}

export { RadioGroup, Radio }
