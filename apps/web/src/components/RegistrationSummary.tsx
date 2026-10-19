import { registrationSummary, STATUS_LABELS, type EventRegistration, type RegistrationStatus } from "@/lib/eventRegistration";

// SCRUM-74/AC6: the summary above an event's registrations: the total, and the number in each status
export function RegistrationSummary({ registrations, capacity }: { registrations: EventRegistration[]; capacity: number | null }) {
  const summary = registrationSummary(registrations, capacity);

  const statuses = Object.keys(STATUS_LABELS) as RegistrationStatus[];

  // One row, a column for each figure, so they read side by side
  return (
    <div className="table-wrap reg-summary">
      <table aria-label="Registration summary">
        <thead>
          <tr>
            <th>Total registrations</th>
            {statuses.map((status) => <th key={status}>{STATUS_LABELS[status]}</th>)}
            {/* SCRUM-74/AC7: only Confirmed registrations use a slot */}
            <th>Slots remaining</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{summary.total}</td>
            {statuses.map((status) => <td key={status}>{summary.byStatus[status]}</td>)}
            {/* SCRUM-74/AC6: an event with no capacity has no limit */}
            <td>{summary.slotsRemaining === null ? "No limit" : `${summary.slotsRemaining} of ${capacity}`}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
