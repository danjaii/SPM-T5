import type { Metadata } from "next";
import Link from "next/link";
import { canDecideEvent, canRequestVenue } from "@spm-t5/shared";
import { CoordinatorAssignment } from "@/components/CoordinatorAssignment";
import { EventChangeHistory } from "@/components/EventChangeHistory";
import { EventChangeRequestForm } from "@/components/EventChangeRequestForm";
import { EventChangeRequestList } from "@/components/EventChangeRequestList";
import { EventComments } from "@/components/EventComments";
import { EventEquipmentRequests } from "@/components/EventEquipmentRequests";
import { EventTechnicalAssignments } from "@/components/EventTechnicalAssignments";
import { EventRequestDetails } from "@/components/EventRequestDetails";
import { EventReviewOutcome } from "@/components/EventReviewOutcome";
import { EventStatusPanel } from "@/components/EventStatusPanel";
import { EventVenueBookings } from "@/components/EventVenueBookings";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { getEventEquipmentRequests } from "@/lib/equipmentRequestsServer";
import { getEventTechnicalAssignments } from "@/lib/technicalAssignmentsServer";
import { getChangeRequests, getEvent, getEventChangeHistory, getEventOutcome } from "@/lib/getEvent";
import { getEventVenueBookings } from "@/lib/venueBookingsServer";

// Rendered per request: what's shown depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Event status · ConnectSphere" };

// SCRUM-6/7/8: view an event's status; the assigned coordinator can also change it. SCRUM-23: the full request.
// SCRUM-42/41/43: who coordinates it, (re)assigning them, and the assignment history.
// SCRUM-44: the review outcome (decision, when, by whom, why).
// SCRUM-25: the conversation between the organiser and the coordinators.
// SCRUM-111: the assigned coordinator edits the event's details; the change history for the coordinator and organiser.
export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const saved = (await searchParams)?.saved === "1";
  const result = await getEvent(id);
  // SCRUM-38/AC4, SCRUM-98/AC5: every venue booking of the event, when the viewer may see them (else null).
  // SCRUM-44: the coordinator's decision, when there is one and the viewer may see it (else null).
  // SCRUM-86: the equipment requests, when the viewer may see them (else null).
  // SCRUM-111/AC4: the change history, when the viewer may see it (else null).
  // SCRUM-20: the on-site technical support assignments, for the event's coordinator (else null).
  const [venueBookings, outcome, equipmentRequests, changeHistory, technicalAssignments] = "event" in result
    ? await Promise.all([
        getEventVenueBookings(id),
        getEventOutcome(id),
        getEventEquipmentRequests(id),
        getEventChangeHistory(id),
        getEventTechnicalAssignments(id),
      ])
    : [null, null, null, null, null];

  const changeRequests = "event" in result && result.event.isOrganiser ? await getChangeRequests(id) : [];

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <div className="event-page">
          <Link className="back-link" href="/dashboard">← Back to dashboard</Link>
          {"event" in result ? (
            <EventStatusPanel event={result.event}>
              {/* SCRUM-44/AC5: "still being reviewed" only while it really is (Submitted / Under review), and only
                  for viewers who can't act on it themselves */}
              <EventReviewOutcome
                decision={outcome}
                showAwaiting={canDecideEvent(result.event.status) && !result.event.canReview && !result.event.canChangeStatus}
              />
              {/* SCRUM-111/AC5: back from the edit form */}
              {saved && <div className="alert alert--ok" role="status">Event details saved.</div>}
              <EventRequestDetails event={result.event} />
              {/* SCRUM-111/AC6, AC7: only the assigned coordinator, while the event is not finished */}
              {result.event.canEdit && (
                <div className="event-buttons">
                  <Link className="btn btn--secondary" href={`/events/${result.event.id}/edit`}>Edit event details</Link>
                </div>
              )}
              <EventChangeHistory entries={changeHistory} />
              <CoordinatorAssignment
                eventId={result.event.id}
                coordinatorName={result.event.point_of_contact_name}
              />
              <EventComments eventId={result.event.id} />
              {/* SCRUM-102: venue bookings can be changed or cancelled while the event can still have venues */}
              <EventVenueBookings
                bookings={venueBookings}
                canChange={canRequestVenue(result.event.status)}
                equipment={equipmentRequests?.requests ?? []}
              />
              {/* SCRUM-86/AC2, AC3: the event's equipment requests; AC6, AC7: Request equipment only when allowed */}
              <EventEquipmentRequests eventId={result.event.id} data={equipmentRequests} />
              {/* SCRUM-20: assign, change and cancel on-site technical support; the technician is notified each time */}
              <EventTechnicalAssignments eventId={result.event.id} data={technicalAssignments} />
              {/* SCRUM-66: organisers see their change requests (AC7) and, while the status allows it, can make one (AC1-AC3) */}
              {result.event.isOrganiser && <EventChangeRequestList requests={changeRequests} />}
              {result.event.canRequestChange && <EventChangeRequestForm event={result.event} />}
              {/* SCRUM-83/AC15: the registration information page (only this page's viewers, organisers and
                  coordinators, can open it; RLS decides whose registrations they see) */}
              <section className="event-section" aria-labelledby="registrations-heading">
                <h2 id="registrations-heading">Registrations</h2>
                <div className="event-detail-card event-detail-card--row">
                  <p>See who has registered for this event.</p>
                  <Link className="btn btn--secondary" href={`/events/${id}/registrations`}>View registrations</Link>
                </div>
              </section>
            </EventStatusPanel>
          ) : (
            <div className="alert alert--error" role="alert">{result.error}</div>
          )}
        </div>
      </main>
    </>
  );
}
