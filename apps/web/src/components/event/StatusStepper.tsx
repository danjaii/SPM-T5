import { Check } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { buildSteps } from "@/lib/eventStepper";
import { cn } from "@/lib/utils";

interface Props {
  status: string;
  /** Whether a coordinator is assigned: a submitted event with one sits on Assigned. */
  hasCoordinator: boolean;
  /** For a rejected or cancelled event, the status it had before. */
  previousStatus?: string | null;
}

// SCRUM-127/AC1, AC2: the event's eight stages with the current one highlighted. A returned, rejected or cancelled event shows
// that state as a StatusBadge on the stage where it happened. State is also written in text, never colour alone.
export function StatusStepper({ status, hasCoordinator, previousStatus }: Props) {
  const steps = buildSteps(status, hasCoordinator, previousStatus);
  return (
    <ol aria-label="Event progress" className="flex items-start gap-2 overflow-x-auto pb-1">
      {steps.map((step, i) => (
        <li
          key={step.label}
          aria-current={step.state === "current" || step.state === "stopped" ? "step" : undefined}
          className="flex shrink-0 flex-col items-start gap-1"
        >
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs",
              step.state === "current" || step.state === "stopped" ? "bg-highlight font-bold text-fg-primary" : step.state === "done" ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {step.state === "done" ? <Check aria-hidden="true" className="size-3.5" /> : <span aria-hidden="true" className="font-bold">{i + 1}</span>}
            {step.label}
            {step.state === "done" && <span className="sr-only"> (done)</span>}
            {step.state === "current" && <span className="sr-only"> (current)</span>}
            {step.state === "stopped" && <span className="sr-only"> (stopped here)</span>}
          </span>
          {step.badge && <StatusBadge {...step.badge} />}
        </li>
      ))}
    </ol>
  );
}
