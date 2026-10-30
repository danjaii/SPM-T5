"use client";

import type { CoordinatorClash } from "@spm-t5/shared";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import { StatusBadge } from "@/components/ui/status-badge";
import type { LeadCoordinatorChoice } from "@/lib/leadServer";

/** SCRUM-168/AC1, AC2, AC5: what the Lead is told about a coordinator's dates; always an icon and a label, never colour alone. */
function ClashBadge({ clash }: { clash: CoordinatorClash }) {
  switch (clash.status) {
    case "clash":
      return <StatusBadge tone="warning" label={`Clashes with ${clash.eventName}`} />;
    case "free":
      return <StatusBadge tone="success" label="Free on this date" />;
    case "no_date":
      return <StatusBadge tone="neutral" label="Event date not set" />;
    case "unavailable":
      return <StatusBadge tone="neutral" label="Dates unavailable" />;
  }
}

const events = (n: number) => `${n} active ${n === 1 ? "event" : "events"}`;

/**
 * SCRUM-168/AC1-AC4: the Lead's coordinators as a list to choose from, each with their active events, the people expected
 * across them and whether they clash with this event. A clash only informs: every coordinator can still be chosen (AC4).
 * Shared by the assign and reassign steps so they show the same thing (AC6).
 */
export function CoordinatorChoiceList({
  coordinators,
  value,
  onChange,
  labelledBy,
}: {
  coordinators: LeadCoordinatorChoice[];
  value: string | null;
  onChange: (id: string) => void;
  labelledBy: string;
}) {
  return (
    <RadioGroup aria-labelledby={labelledBy} value={value ?? ""} onValueChange={(id) => onChange(String(id))}>
      {coordinators.map((c) => (
        <label
          key={c.id}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 has-data-checked:border-primary has-data-checked:bg-accent"
        >
          <Radio value={c.id} className="mt-1" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-medium">{c.full_name}</span>
              <span className="text-xs text-muted-foreground">
                {events(c.workload)}
                {c.total_attendance !== null && ` · ${c.total_attendance} people expected`}
              </span>
            </span>
            <span>
              <ClashBadge clash={c.clash} />
            </span>
          </span>
        </label>
      ))}
    </RadioGroup>
  );
}
