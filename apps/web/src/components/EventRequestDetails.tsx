import { Fragment, type ReactNode } from "react";
import type { EventDetailView } from "@/lib/events";

// SCRUM-23/AC3: what a field shows when the organiser left it blank, so it's never mistaken for real data.
export const NOT_PROVIDED = "Not provided";

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" });

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-SG", { dateStyle: "medium", timeZone: "Asia/Singapore" });

function preferredSlot(start: string | null, end: string | null): string | null {
  if (!start) return null;
  return end ? `${formatDateTime(start)} – ${formatDateTime(end)}` : formatDateTime(start);
}

function Value({ children }: { children: ReactNode }) {
  return children == null || children === "" ? <span className="event__missing">{NOT_PROVIDED}</span> : <>{children}</>;
}

// SCRUM-23/AC2: everything the organiser submitted, for the coordinator to assess the request.
// Current status is shown by EventStatusPanel above this section.
export function EventRequestDetails({ event }: { event: EventDetailView }) {
  const rows: [string, ReactNode][] = [
    ["Organiser", event.organiser_name],
    ["Purpose", event.purpose],
    ["Preferred date and time", preferredSlot(event.preferred_start_datetime, event.preferred_end_datetime)],
    ["Expected attendees", event.expected_attendance === null ? null : `${event.expected_attendance} people`],
    ["Layout preference", event.preferred_layout_name],
    ["Accessibility needs", event.accessibility_requirements],
    ["Equipment needs", event.equipment_requirements_notes],
    ["Submitted", event.submitted_at && formatDate(event.submitted_at)],
  ];

  return (
    <section className="event-section" aria-labelledby="request-details">
      <h2 id="request-details">Request details</h2>
      <dl className="venue__facts">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt>{label}</dt>
            <dd>
              <Value>{value}</Value>
            </dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}
