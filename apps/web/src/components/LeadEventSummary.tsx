import { formatSgt } from "@/lib/bookingQueue";
import { formatEventDateTime } from "@/lib/formatEventDateTime";
import type { LeadEvent } from "@/lib/leadServer";

const NOT_SPECIFIED = "Not specified";

// SCRUM-78 / SCRUM-79: the event, as the Lead sees it while assigning or reassigning its coordinator.
export function LeadEventSummary({ event }: { event: LeadEvent }) {
  return (
    <dl className="event-detail-card">
      <dt>Event Organiser</dt>
      <dd>{event.organiser_name ?? "Unknown"}</dd>
      <dt>Preferred date and time</dt>
      <dd>{event.preferred_start_datetime ? formatEventDateTime(event.preferred_start_datetime, event.preferred_end_datetime) : NOT_SPECIFIED}</dd>
      <dt>Expected attendance</dt>
      <dd>{event.expected_attendance ?? NOT_SPECIFIED}</dd>
      <dt>Submitted</dt>
      <dd>{event.submitted_at ? formatSgt(event.submitted_at) : NOT_SPECIFIED}</dd>
    </dl>
  );
}
