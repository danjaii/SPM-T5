import { formatEventDateTime } from "@/lib/formatEventDateTime";
import { STATUS_LABELS, type MyRegistration } from "@/lib/eventRegistration";

// SCRUM-83/AC15: the attendee's "My registrations": each registration with its event, when it is, and its status.
// AC6: earlier (Withdrawn/Rejected) registrations stay in the history, so they're listed too.
export function MyRegistrationList({ registrations }: { registrations: MyRegistration[] }) {
  if (registrations.length === 0) return <p className="empty">You haven&apos;t registered for any events yet.</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>When</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {registrations.map((r) => (
            <tr key={r.id}>
              <td>{r.event.name}</td>
              <td>{formatEventDateTime(r.event.start_at, r.event.end_at)}</td>
              <td><span className="status-badge">{STATUS_LABELS[r.status]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
