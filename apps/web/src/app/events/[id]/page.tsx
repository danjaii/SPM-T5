import type { Metadata } from "next";
import Link from "next/link";
import { CoordinatorAssignment } from "@/components/CoordinatorAssignment";
import { EventRequestDetails } from "@/components/EventRequestDetails";
import { EventStatusPanel } from "@/components/EventStatusPanel";
import { EventVenueBooking } from "@/components/EventVenueBooking";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { getEvent } from "@/lib/getEvent";
import { getApprovedVenueBooking } from "@/lib/venueBookingsServer";

// Rendered per request: what's shown depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Event status · ConnectSphere" };

// SCRUM-6/7/8: view an event's status; the assigned coordinator can also change it. SCRUM-23: the full request.
// SCRUM-42/41/43: who coordinates it, (re)assigning them, and the assignment history.
export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getEvent(id);
  // SCRUM-38/AC4: the approved venue, when there is one and the viewer may see it (else null).
  const venueBooking = "event" in result ? await getApprovedVenueBooking(id) : null;

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
              <EventRequestDetails event={result.event} />
              <CoordinatorAssignment
                eventId={result.event.id}
                coordinatorName={result.event.point_of_contact_name}
                canAssign={result.event.canAssign}
              />
              <EventVenueBooking booking={venueBooking} />
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
