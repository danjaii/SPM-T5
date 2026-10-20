"use client";

import { Check } from "lucide-react";
import { Fragment, useEffect, useRef } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { buildSteps, type StepState } from "@/lib/eventStepper";
import { cn } from "@/lib/utils";

interface Props {
  status: string;
  /** Whether a coordinator is assigned: a submitted event with one sits on Assigned. */
  hasCoordinator: boolean;
  /** For a rejected or cancelled event, the status it had before. */
  previousStatus?: string | null;
}

const reached = (state: StepState) => state === "done" || state === "current" || state === "stopped";

// SCRUM-127/AC1, AC2: Figma "Status stepper". The event's eight stages in a card: a check for done, a ringed number for the current
// step, a muted number for the rest, joined by lines that are solid up to the current step. A returned, rejected or cancelled event
// shows that state as a StatusBadge under the step where it happened. State is also written in text, never colour alone.
export function StatusStepper({ status, hasCoordinator, previousStatus }: Props) {
  const steps = buildSteps(status, hasCoordinator, previousStatus);
  const box = useRef<HTMLDivElement>(null);
  // on a narrow screen the card scrolls sideways, so open it on the step the event is at
  useEffect(() => {
    box.current?.querySelector("[aria-current]")?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [status]);
  return (
    <div ref={box} className="overflow-x-auto rounded-xl border border-border bg-card px-5 py-4">
      <ol aria-label="Event progress" className="flex w-full min-w-max items-start">
        {steps.map((step, i) => {
          const marked = step.state === "current" || step.state === "stopped";
          return (
            <Fragment key={step.label}>
              {i > 0 && (
                // the line into a step is solid once that step is reached; its height matches the 24px circle so it sits level with it
                <li aria-hidden="true" className="flex h-6 min-w-6 flex-1 items-center px-2">
                  <span className={cn("h-0.5 flex-1", reached(step.state) ? "bg-primary" : "bg-border-strong")} />
                </li>
              )}
              <li aria-current={marked ? "step" : undefined} className="flex shrink-0 flex-col items-start gap-1.5">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                      step.state === "done" && "bg-primary text-primary-foreground",
                      marked && "border-2 border-primary bg-card text-fg-primary",
                      step.state === "upcoming" && "bg-muted text-muted-foreground",
                    )}
                  >
                    {step.state === "done" ? <Check className="size-3.5" /> : i + 1}
                  </span>
                  <span className={cn("whitespace-nowrap text-[13px]", marked ? "font-bold text-foreground" : step.state === "done" ? "font-medium text-foreground" : "font-medium text-muted-foreground")}>
                    {step.label}
                    {step.state === "done" && <span className="sr-only"> (done)</span>}
                    {step.state === "current" && <span className="sr-only"> (current)</span>}
                    {step.state === "stopped" && <span className="sr-only"> (stopped here)</span>}
                  </span>
                </span>
                {step.badge && <StatusBadge {...step.badge} />}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}
