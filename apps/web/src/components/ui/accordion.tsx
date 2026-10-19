"use client"

import * as React from "react"
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion"
import { ChevronDown } from "lucide-react"
import { cn } from "cn"

function Accordion({ className, ...props }: AccordionPrimitive.Root.Props) {
  return <AccordionPrimitive.Root data-slot="accordion" className={cn("flex flex-col gap-3", className)} {...props} />
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return <AccordionPrimitive.Item data-slot="accordion-item" className={cn("rounded-xl bg-muted", className)} {...props} />
}

// SCRUM-123: the trigger fills the header and an optional `action` (for example an Edit button) sits beside it. The action is
// a sibling of the trigger, never inside it, because a button cannot contain a button.
function AccordionTrigger({
  className,
  children,
  action,
  ...props
}: AccordionPrimitive.Trigger.Props & { action?: React.ReactNode }) {
  return (
    <AccordionPrimitive.Header className="flex items-center gap-2 pr-3">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group/trigger flex min-h-11 flex-1 items-center justify-between gap-2 rounded-xl px-4 py-3 text-left text-base font-bold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          className
        )}
        {...props}
      >
        {children}
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open/trigger:rotate-180" />
      </AccordionPrimitive.Trigger>
      {action}
    </AccordionPrimitive.Header>
  )
}

function AccordionPanel({ className, ...props }: AccordionPrimitive.Panel.Props) {
  return <AccordionPrimitive.Panel data-slot="accordion-panel" className={cn("px-4 pb-4", className)} {...props} />
}

export { Accordion, AccordionItem, AccordionPanel, AccordionTrigger }
