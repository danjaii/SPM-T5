import { formatEventDateTime } from "@/lib/formatEventDateTime";
import { STATUS_LABELS, type MyRegistration } from "@/lib/eventRegistration";

// SCRUM-83/AC15: the attendee's "My registrations": each registration with its event, when it is, and its status.
// AC6: earlier (Withdrawn/Rejected) registrations stay in the history, so they're listed too.
export function MyRegistrationList({ registrations }: { registrations: MyRegistration[] }) {
  // SCRUM-72/AC5: no registration for an upcoming event (event-service sends only upcoming ones, SCRUM-72/AC1)
  if (registrations.length === 0) return <p className="empty">You have not registered for an event</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>When</th>
            <th>Where</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {registrations.map((r) => (
            <tr key={r.id}>
              <td>{r.event.name}</td>
              <td>{formatEventDateTime(r.event.start_at, r.event.end_at)}</td>
              {/* SCRUM-72/AC4: the location, the venue's name and address (as on the List of events, SCRUM-71/AC3) */}
              <td>{r.event.venue.name ? `${r.event.venue.name}, ${r.event.venue.address}` : "Venue to be confirmed"}</td>
              {/* SCRUM-72/AC3: the label, in its status's colour (globals.css) */}
              <td><span className={`status-badge status-badge--${r.status}`}>{STATUS_LABELS[r.status]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
