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
import { NeedsAttentionBanner } from "@/components/NeedsAttentionBanner";
import { EventSafetyDecisions } from "@/components/EventSafetyDecisions";
import { EventSection, Unavailable } from "@/components/event/EventSection";
import { InlineMessage } from "@/components/event/InlineMessage";
import { tabFrom } from "@/components/event/EventTabs";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getEquipmentRequestForm, getEventEquipmentRequests } from "@/lib/equipmentRequestsServer";
import { getEventTechnicalAssignments } from "@/lib/technicalAssignmentsServer";
import { formatEventDateTime } from "@/lib/formatEventDateTime";
import { getChangeRequests, getEvent, getEventChangeHistory, getEventOutcome, getEventSafetyDecisions } from "@/lib/getEvent";
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
  searchParams?: Promise<{ saved?: string; submitted?: string; tab?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const saved = query?.saved === "1";
  // SCRUM-123/AC4: arriving from the new request form
  const justSubmitted = query?.submitted === "1";
  const tab = tabFrom(query?.tab);
  const result = await getEvent(id);
  // SCRUM-38/AC4, SCRUM-98/AC5: every venue booking of the event, when the viewer may see them (else null).
  // SCRUM-44: the coordinator's decision, when there is one and the viewer may see it (else null).
  // SCRUM-86: the equipment requests, when the viewer may see them (else null).
  // SCRUM-111/AC4: the change history, when the viewer may see it (else null).
  // SCRUM-20: the on-site technical support assignments, for the event's coordinator (else null).
  // SCRUM-100/AC7: the Safety Officer's requested changes, for the event's coordinator and organiser (else null).
  const [venueBookings, outcome, equipmentRequests, changeHistory, technicalAssignments, safetyDecisions] = "event" in result
    ? await Promise.all([
        getEventVenueBookings(id),
        getEventOutcome(id),
        getEventEquipmentRequests(id),
        getEventChangeHistory(id),
        getEventTechnicalAssignments(id),
        getEventSafetyDecisions(id),
      ])
    : [null, null, null, null, null, null];

  // SCRUM-136/AC1: the choices for the Equipment tab's add and change row, only for a viewer who may add or change one
  const equipmentForm = tab === "equipment" && equipmentRequests?.canCreate ? await getEquipmentRequestForm(id) : null;

  // SCRUM-66: the organiser's own requests; SCRUM-67: the assigned coordinator reviews them
  const seesChangeRequests = "event" in result && (result.event.isOrganiser || result.event.canChangeStatus);
  const changeRequests = seesChangeRequests ? await getChangeRequests(id) : [];

  const view = "event" in result ? result.event : null;
  // SCRUM-127: the line under the title (Figma frame 05): who, when and how many
  const meta = view
    ? [
        view.organiser_name && `Organiser ${view.organiser_name}`,
        view.point_of_contact_name && `Coordinator ${view.point_of_contact_name}`,
        view.preferred_start_datetime && new Date(view.preferred_start_datetime).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" }),
        view.expected_attendance !== null && `${view.expected_attendance} expected`,
      ].filter(Boolean).join(" · ")
    : undefined;

  // SCRUM-159/AC3: inside the shared app shell only; the old top bar (AppHeader) is gone, for organisers and coordinators
  return (
    <main className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <Link className="mb-4 inline-block text-sm font-medium text-fg-primary hover:underline" href="/dashboard">← Back to dashboard</Link>
      {view ? (
        <EventStatusPanel event={view} activeTab={tab} meta={meta} notice={venueBookings && <NeedsAttentionBanner bookings={venueBookings} />}>
          {tab === "overview" && (
            <>
              {/* SCRUM-44/AC5: "still being reviewed" only while it really is (Submitted / Under review), and only
                  for viewers who can't act on it themselves */}
              <EventReviewOutcome
                decision={outcome}
                showAwaiting={canDecideEvent(view.status) && !view.canReview && !view.canChangeStatus}
              />
              {/* SCRUM-123/AC4, SCRUM-49/AC6: confirmation with the submission time; the status is the panel above */}
              {justSubmitted && (
                <InlineMessage kind="ok">
                  Your event request was submitted
                  {view.submitted_at ? ` on ${formatEventDateTime(view.submitted_at, null)}` : ""}.
                </InlineMessage>
              )}
              {/* SCRUM-111/AC5: back from the edit form */}
              {saved && <InlineMessage kind="ok">Event details saved.</InlineMessage>}
              <EventRequestDetails event={view} />
              <EventComments eventId={view.id} />
            </>
          )}
          {tab === "venues" && (
            /* SCRUM-102: venue bookings can be changed or cancelled while the event can still have venues */
            venueBookings
              ? <EventVenueBookings bookings={venueBookings} canChange={canRequestVenue(view.status)} equipment={equipmentRequests?.requests ?? []} requestHref={canRequestVenue(view.status) ? `/events/${view.id}/venue-request` : undefined} />
              : <Unavailable id="venue-bookings-heading" title="Venue bookings" />
          )}
          {tab === "equipment" && (
            <>
              {/* SCRUM-86/AC2, AC3: the event's equipment requests; AC6, AC7, SCRUM-136/AC1: Add item only when allowed */}
              {equipmentRequests
                ? <EventEquipmentRequests data={equipmentRequests} form={equipmentForm && "form" in equipmentForm ? equipmentForm.form : null} />
                : <Unavailable id="equipment-requests-heading" title="Equipment requests" />}
              {/* SCRUM-20: assign, change and cancel on-site technical support; the technician is notified each time */}
              <EventTechnicalAssignments eventId={view.id} data={technicalAssignments} />
            </>
          )}
          {tab === "safety" && (
            safetyDecisions
              ? <EventSafetyDecisions decisions={safetyDecisions} />
              : <Unavailable id="safety-decisions-heading" title="Safety check" />
          )}
          {tab === "registrations" && (
            /* SCRUM-83/AC15: the registration information page (only this page's viewers, organisers and
               coordinators, can open it; RLS decides whose registrations they see) */
            <EventSection id="registrations-heading" title="Registrations">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">See who has registered for this event.</p>
                <Link className={cn(buttonVariants({ variant: "outline" }))} href={`/events/${id}/registrations`}>View registrations</Link>
              </div>
            </EventSection>
          )}
          {tab === "changes" && (
            <>
              <CoordinatorAssignment eventId={view.id} coordinatorName={view.point_of_contact_name} />
              <EventChangeHistory entries={changeHistory} />
              {/* SCRUM-66: organisers see their change requests (AC7) and, while the status allows it, can make one (AC1-AC3) */}
              {(view.isOrganiser || view.canChangeStatus) && (
                <EventChangeRequestList requests={changeRequests} reviewable={view.canChangeStatus} />
              )}
              {view.canRequestChange && <EventChangeRequestForm event={view} requests={changeRequests} />}
            </>
          )}
        </EventStatusPanel>
      ) : (
        <InlineMessage kind="error">{"error" in result ? result.error : "We couldn't load this event."}</InlineMessage>
      )}
    </main>
  );
}
