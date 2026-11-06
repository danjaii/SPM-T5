"use client";

import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { statusLabel } from "./EventStatusBadge";

const ALL_LABEL = "All statuses";

/** What the closed filter says: every status, the one chosen, or how many. */
function summary(selected: readonly string[]): string {
  if (selected.length === 0) return ALL_LABEL;
  return selected.length === 1 ? statusLabel(selected[0]) : `${selected.length} statuses`;
}

// SCRUM-198: choose any number of statuses. None chosen means every status, so the filter can't be left empty by accident.
export function StatusMultiSelect({
  statuses,
  selected,
  onChange,
}: {
  statuses: readonly string[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
}) {
  const valueId = useId();
  const toggle = (status: string) =>
    onChange(statuses.filter((s) => (s === status ? !selected.includes(s) : selected.includes(s))));

  return (
    <Popover>
      <PopoverTrigger
        render={<Button type="button" variant="outline" className="w-full justify-between font-normal" />}
        aria-label="Status"
        aria-describedby={valueId}
      >
        <span id={valueId} className="truncate">{summary(selected)}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 gap-1">
        <label className="flex items-center gap-2 rounded-md p-1.5 text-sm">
          <Checkbox checked={selected.length === 0} onCheckedChange={() => onChange([])} />
          {ALL_LABEL}
        </label>
        {statuses.map((status) => (
          <label key={status} className="flex items-center gap-2 rounded-md p-1.5 text-sm">
            <Checkbox checked={selected.includes(status)} onCheckedChange={() => toggle(status)} />
            {statusLabel(status)}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}
