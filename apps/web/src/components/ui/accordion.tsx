"use client"

import * as React from "react"
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion"
import { ChevronDown } from "lucide-react"
import { cn } from "cn"

// A flat list: hairline dividers between items, no fills or boxes.
function Accordion({ className, ...props }: AccordionPrimitive.Root.Props) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn("flex flex-col divide-y divide-border border-y border-border", className)}
      {...props}
    />
  )
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return <AccordionPrimitive.Item data-slot="accordion-item" className={cn(className)} {...props} />
}

// SCRUM-123: the chevron and heading form the trigger; an optional `action` (for example an Edit link) sits at the far end.
// The action is a sibling of the trigger, never inside it, because a button cannot contain a button.
function AccordionTrigger({
  className,
  children,
  action,
  ...props
}: AccordionPrimitive.Trigger.Props & { action?: React.ReactNode }) {
  return (
    <AccordionPrimitive.Header className="flex items-center gap-3">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group/trigger flex min-h-14 flex-1 items-center gap-3 rounded-md py-4 text-left text-base font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          className
        )}
        {...props}
      >
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 -rotate-90 text-muted-foreground transition-transform group-data-panel-open/trigger:rotate-0"
        />
        {children}
      </AccordionPrimitive.Trigger>
      {action}
    </AccordionPrimitive.Header>
  )
}

function AccordionPanel({ className, ...props }: AccordionPrimitive.Panel.Props) {
  return <AccordionPrimitive.Panel data-slot="accordion-panel" className={cn("pb-5 pl-7", className)} {...props} />
}

export { Accordion, AccordionItem, AccordionPanel, AccordionTrigger }
