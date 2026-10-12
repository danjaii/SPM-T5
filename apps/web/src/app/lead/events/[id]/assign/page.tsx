import type { Metadata } from "next";
import Link from "next/link";
import { isClosedEventStatus } from "@spm-t5/shared";
import { LeadAssignForm } from "@/components/LeadAssignForm";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { formatSgt } from "@/lib/bookingQueue";
import { formatEventDateTime } from "@/lib/formatEventDateTime";
import { getLeadAssignment, type LeadAssignment } from "@/lib/leadServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Assign a coordinator · ConnectSphere" };

const NOT_SPECIFIED = "Not specified";

function EventSummary({ event }: { event: LeadAssignment["event"] }) {
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

// SCRUM-78: the Lead assigns an unassigned event request to one of their coordinators, opened from the queue.
export default async function LeadAssignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getLeadAssignment(id);

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href="/lead/queue">← Back to unassigned event requests</Link>
        {"assignment" in result ? (
          <>
            <h1>Assign a coordinator to {result.assignment.event.name}</h1>
            <EventSummary event={result.assignment.event} />
            {result.assignment.canAssign ? (
              <LeadAssignForm eventId={id} eventName={result.assignment.event.name} coordinators={result.assignment.coordinators} />
            ) : (
              // SCRUM-78/AC6 (closed) and AC3 (already assigned): no assign action
              <p className="alert alert--info">
                {isClosedEventStatus(result.assignment.event.status)
                  ? "This event is closed, so a coordinator can't be assigned."
                  : "This event already has a coordinator."}
              </p>
            )}
          </>
        ) : (
          <>
            <h1>Assign a coordinator</h1>
            <div className="alert alert--error" role="alert">{result.error}</div>
          </>
        )}
      </main>
    </>
  );
}
