import type { Metadata } from "next";
import Link from "next/link";
import { EventChangeRequestForm } from "@/components/EventChangeRequestForm";
import { EventChangeRequestList } from "@/components/EventChangeRequestList";
import { EventRequestDetails } from "@/components/EventRequestDetails";
import { EventStatusPanel } from "@/components/EventStatusPanel";
import { EventVenueBooking } from "@/components/EventVenueBooking";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { getChangeRequests, getEvent } from "@/lib/getEvent";
import { getApprovedVenueBooking } from "@/lib/venueBookingsServer";

// Rendered per request: what's shown depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Event status · ConnectSphere" };

// SCRUM-6/7/8: view an event's status; the assigned coordinator can also change it. SCRUM-23: the full request.
export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getEvent(id);
  // SCRUM-38/AC4: the approved venue, when there is one and the viewer may see it (else null).
  const venueBooking = "event" in result ? await getApprovedVenueBooking(id) : null;

  const changeRequests = "event" in result && result.event.isOrganiser ? await getChangeRequests(id) : [];

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href="/dashboard">← Back to dashboard</Link>
        {"event" in result ? (
          <>
            <EventStatusPanel event={result.event} />
            <EventRequestDetails event={result.event} />
            <EventVenueBooking booking={venueBooking} />
            {/* SCRUM-66: organisers see their change requests (AC7) and, while the status allows it, can make one (AC1-AC3) */}
            {result.event.isOrganiser && <EventChangeRequestList requests={changeRequests} />}
            {result.event.canRequestChange && <EventChangeRequestForm event={result.event} />}
          </>
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
