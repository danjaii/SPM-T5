"use client";

import { useRouter } from "next/navigation";
import type { ManagedEvent } from "@/lib/eventRegistration";

// SCRUM-74/AC3: the organiser or coordinator picks one of the events they manage to see its registrations.
// The choice goes in the address (?event=<id>), so the page loads that event's registrations on the server.
export function EventPicker({ events, selectedId }: { events: ManagedEvent[]; selectedId: string | null }) {
  const router = useRouter();

  return (
    <div className="field">
      <label htmlFor="managed-event">Event</label>
      <select
        id="managed-event"
        value={selectedId ?? ""}
        onChange={(e) => router.push(`/registrations-overview?event=${encodeURIComponent(e.target.value)}`)}
      >
        <option value="" disabled>Choose an event</option>
        {events.map((e) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>
    </div>
  );
}
