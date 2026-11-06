"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { shortDay, viewTitle, type CalendarView } from "@/lib/venueTimeline";

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];
const PERIOD_NAME: Record<CalendarView, string> = { day: "day", week: "week", month: "month" };

// SCRUM-130 (Figma 09): Day / Week / Month, the date stepper and Today. Each change asks venue-service for the new range.
export function VenueCalendarToolbar({
  view,
  anchor,
  busy,
  onView,
  onStep,
  onToday,
}: {
  view: CalendarView;
  anchor: string;
  busy: boolean;
  onView: (view: CalendarView) => void;
  onStep: (direction: 1 | -1) => void;
  onToday: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Tabs value={view} onValueChange={(value) => onView(value as CalendarView)}>
        <TabsList aria-label="Calendar view">
          {VIEWS.map(({ value, label }) => (
            <TabsTrigger key={value} value={value} className="px-3">{label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Previous ${PERIOD_NAME[view]}`} disabled={busy} onClick={() => onStep(-1)}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <span aria-live="polite" className="min-w-24 text-center text-sm font-medium text-foreground">
          {view === "day" ? shortDay(anchor) : viewTitle(view, anchor)}
        </span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Next ${PERIOD_NAME[view]}`} disabled={busy} onClick={() => onStep(1)}>
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onToday}>Today</Button>
    </div>
  );
}
