import { Check } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { STEPS } from "@/lib/eventRequestForm";
import { cn } from "@/lib/utils";

// SCRUM-123/AC1: a progress bar with "Step 3 of 6", and the list of steps (ticked when done, numbered when not). Narrow
// screens show the bar and the current step's name; the full list appears from the md breakpoint up.
export function RequestStepper({ current, onGoTo }: { current: number; onGoTo: (step: number) => void }) {
  const total = STEPS.length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-foreground" aria-live="polite">
          Step {current + 1} of {total}: {STEPS[current].label}
          <span className="font-normal text-muted-foreground">
            {" "}
            · {total - current - 1 === 0 ? "last step" : `${total - current - 1} left`}
          </span>
        </p>
        <Progress value={current + 1} max={total} aria-label="Request progress" />
      </div>

      <nav aria-label="Request steps" className="hidden rounded-xl bg-card p-3 ring-1 ring-foreground/10 md:block">
        <ol className="flex flex-col gap-1">
          {STEPS.map((step, i) => {
            const done = i < current;
            return (
              <li key={step.key}>
                <button
                  type="button"
                  disabled={i > current}
                  onClick={() => onGoTo(i)}
                  aria-current={i === current ? "step" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-default",
                    i === current ? "bg-highlight" : "enabled:hover:bg-accent"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
                      done ? "border-primary bg-primary text-primary-foreground" : "border-border-strong text-foreground"
                    )}
                  >
                    {done ? <Check className="size-3.5" /> : i + 1}
                  </span>
                  <span className="flex flex-col">
                    <span className={cn("text-sm text-foreground", i === current ? "font-bold" : "font-semibold")}>
                      {step.label}
                      {done ? <span className="sr-only"> (done)</span> : null}
                    </span>
                    <span className="text-xs text-muted-foreground">{step.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
