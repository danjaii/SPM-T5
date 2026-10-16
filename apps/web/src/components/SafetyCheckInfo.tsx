import type { ReactNode } from "react";
import type { SafetyCheckDetails } from "@/lib/safetyCheckServer";

const NOT_RECORDED = "Not recorded";

/** The value, or "Not recorded": a gap in the safety information must be visible, not blank. */
const orNotRecorded = (value: string | number | null) => (value === null || value === "" ? NOT_RECORDED : value);

/** One AC3 item: a heading and the list of what is known about it. */
function InfoSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="event-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <div className="event-detail-card">
        <ul>{children}</ul>
      </div>
    </section>
  );
}

// SCRUM-99/AC3: the information needed for the safety check. Venue facts are named by venue, because an event can be
// booked into several (SCRUM-98).
export function SafetyCheckInfo({ details }: { details: SafetyCheckDetails }) {
  const { venues } = details;
  return (
    <>
      <InfoSection id="safety-attendance" title="Expected attendance">
        <li>{orNotRecorded(details.expected_attendance)}</li>
      </InfoSection>

      <InfoSection id="safety-capacity" title="Venue capacity and layout">
        {venues.map((v) => (
          <li key={v.name}>
            {`${v.name}: holds ${v.max_capacity}`}
            {!details.layout
              ? " (no layout chosen)"
              : v.layout_capacity === null
                ? `, ${details.layout} layout not listed for this venue`
                : `, ${v.layout_capacity} in ${details.layout} layout`}
          </li>
        ))}
      </InfoSection>

      <InfoSection id="safety-emergency" title="Emergency access">
        {venues.map((v) => <li key={v.name}>{`${v.name}: ${orNotRecorded(v.emergency_access)}`}</li>)}
      </InfoSection>

      <InfoSection id="safety-accessibility" title="Accessibility requirements">
        <li>{`Event: ${orNotRecorded(details.accessibility_requirements)}`}</li>
        {venues.map((v) => <li key={v.name}>{`${v.name}: ${orNotRecorded(v.accessibility_notes)}`}</li>)}
      </InfoSection>

      <InfoSection id="safety-equipment" title="Equipment placement">
        {details.equipment.length === 0 && <li>No equipment requested</li>}
        {details.equipment.map((q) => <li key={q.name}>{`${q.name} × ${q.quantity}: ${orNotRecorded(q.placement)}`}</li>)}
      </InfoSection>

      <InfoSection id="safety-restrictions" title="Known venue restrictions">
        {venues.map((v) => <li key={v.name}>{`${v.name}: ${orNotRecorded(v.restrictions)}`}</li>)}
        {venues.flatMap((v) =>
          v.unavailability.map((u) => <li key={`${v.name}-${u.start}`}>{`${v.name} unavailable (${u.reason}): ${u.notes}`}</li>),
        )}
      </InfoSection>
    </>
  );
}
