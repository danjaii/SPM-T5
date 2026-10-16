import Link from "next/link";
import { formatEventDateTime } from "@/lib/formatEventDateTime";
import type { SafetyQueueItem } from "@/lib/safetyCheckServer";

const NOT_SPECIFIED = "Not specified";

// SCRUM-99/AC2: the events ready for an Operational Safety Check, in the order event-service sends them (soonest first).
export function SafetyCheckQueue({ events }: { events: SafetyQueueItem[] }) {
  if (events.length === 0) return <p className="empty">No events are waiting for a safety check.</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>Date and time</th>
            <th>Expected attendance</th>
            <th>Venues</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td><Link href={`/safety-checks/${e.id}`} aria-label={`Review ${e.name}`}>{e.name}</Link></td>
              <td>{e.preferred_start_datetime ? formatEventDateTime(e.preferred_start_datetime, e.preferred_end_datetime) : NOT_SPECIFIED}</td>
              <td>{e.expected_attendance ?? NOT_SPECIFIED}</td>
              <td>{e.venue_names.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
