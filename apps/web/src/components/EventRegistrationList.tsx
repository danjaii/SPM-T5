import { STATUS_LABELS, type EventRegistration } from "@/lib/eventRegistration";

/** SCRUM-74/AC10: a list longer than this scrolls. */
const SCROLL_AFTER_ROWS = 15;

// SCRUM-74/AC5: the registration's date and time
const formatRegistered = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" });

// SCRUM-83/AC15: an event's registrations, for its organiser and assigned coordinator: the details each attendee
// submitted on the form, and the registration's status
export function EventRegistrationList({ registrations }: { registrations: EventRegistration[] }) {
  if (registrations.length === 0) return <p className="empty">Nobody has registered for this event yet.</p>;

  return (
    // SCRUM-74/AC10: more than 15 rows scroll inside the box
    <div className={registrations.length > SCROLL_AFTER_ROWS ? "table-wrap table-wrap--scroll" : "table-wrap"}>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Contact number</th>
            <th>Status</th>
            <th>Registered</th>
          </tr>
        </thead>
        <tbody>
          {registrations.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.email}</td>
              <td>{r.phone}</td>
              <td><span className="status-badge">{STATUS_LABELS[r.status]}</span></td>
              <td>{formatRegistered(r.registered_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
