import { STATUS_LABELS, type EventRegistration } from "@/lib/eventRegistration";

const formatRegistered = (iso: string) =>
  new Date(iso).toLocaleDateString("en-SG", { dateStyle: "medium", timeZone: "Asia/Singapore" });

// SCRUM-83/AC15: an event's registrations, for its organiser and assigned coordinator: the details each attendee
// submitted on the form, and the registration's status
export function EventRegistrationList({ registrations }: { registrations: EventRegistration[] }) {
  if (registrations.length === 0) return <p className="empty">Nobody has registered for this event yet.</p>;

  return (
    <div className="table-wrap">
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
