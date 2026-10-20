import Link from "next/link";
import EventStatusBadge from "@/components/EventStatusBadge";
import { formatEventDateTime } from "@/lib/formatEventDateTime";
import type { LeadCoordinatorEvent } from "@/lib/leadServer";

const NOT_SPECIFIED = "Not specified";

// SCRUM-81/AC2-AC4: one coordinator's non-closed events.
export function LeadCoordinatorEvents({ events }: { events: LeadCoordinatorEvent[] }) {
  if (events.length === 0) return <p className="empty">This coordinator has no active events.</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>Status</th>
            <th>Preferred date and time</th>
            <th>Expected attendance</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              {/* SCRUM-79/AC1: choosing an event opens its reassign step */}
              <td><Link href={`/lead/events/${e.id}/reassign`} aria-label={`Reassign ${e.name}`}>{e.name}</Link></td>
              <td><EventStatusBadge status={e.status} /></td>
              <td>{e.preferred_start_datetime ? formatEventDateTime(e.preferred_start_datetime, e.preferred_end_datetime) : NOT_SPECIFIED}</td>
              <td>{e.expected_attendance ?? NOT_SPECIFIED}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
