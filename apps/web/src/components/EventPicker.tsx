"use client";

import { CalendarDays } from "lucide-react";
import { useRouter } from "next/navigation";
import EventStatusBadge from "@/components/EventStatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ManagedEvent } from "@/lib/eventRegistration";
import { formatEventDateTime } from "@/lib/formatEventDateTime";

// SCRUM-74/AC3: the organiser or coordinator picks one of the events they manage to see its registrations.
// The choice goes in the address (?event=<id>), so the page loads that event's registrations on the server.
// SCRUM-139/AC10: a shadcn Select, so it is reachable and operable from the keyboard with a visible focus ring.
// Redesign (common region, proximity): the dropdown and the facts about the chosen event (its date and status) share one card,
// so the choice and what it refers to read as a unit, and the card sits apart from the figures below it.
export function EventPicker({ events, selectedId }: { events: ManagedEvent[]; selectedId: string | null }) {
  const router = useRouter();
  const selected = events.find((e) => e.id === selectedId);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex w-full flex-col gap-1.5 sm:max-w-sm">
          <label id="managed-event-label" className="text-sm font-semibold text-foreground">Event</label>
          <Select value={selectedId ?? ""} onValueChange={(id) => router.push(`/registrations-overview?event=${encodeURIComponent(String(id))}`)}>
            <SelectTrigger aria-labelledby="managed-event-label" className="w-full">
              <SelectValue placeholder="Choose an event">
                {(value: string | null) => events.find((e) => e.id === value)?.name ?? "Choose an event"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {events.map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selected && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {selected.start_at && (
              <p className="flex items-center gap-2">
                <CalendarDays aria-hidden="true" className="size-4 shrink-0" />
                <time dateTime={selected.start_at}>{formatEventDateTime(selected.start_at, null)}</time>
              </p>
            )}
            <EventStatusBadge status={selected.status} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
