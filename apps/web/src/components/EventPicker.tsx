"use client";

import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ManagedEvent } from "@/lib/eventRegistration";

// SCRUM-74/AC3: the organiser or coordinator picks one of the events they manage to see its registrations.
// The choice goes in the address (?event=<id>), so the page loads that event's registrations on the server.
// SCRUM-139/AC10: a shadcn Select, so it is reachable and operable from the keyboard with a visible focus ring.
export function EventPicker({ events, selectedId }: { events: ManagedEvent[]; selectedId: string | null }) {
  const router = useRouter();

  return (
    <div className="flex max-w-md flex-col gap-1.5">
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
  );
}
