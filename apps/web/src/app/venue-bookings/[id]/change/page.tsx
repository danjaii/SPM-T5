import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { VenueBookingChangeForm } from "@/components/VenueBookingChangeForm";
import { getEventEquipmentRequests } from "@/lib/equipmentRequestsServer";
import { equipmentFor, isChangeableVenueBooking } from "@/lib/venueBookings";
import { getVenueBooking } from "@/lib/venueBookingsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Change venue booking · ConnectSphere" };

// SCRUM-102/AC1: change one venue booking of an event. AC8: the form lists the equipment requested for it, which moves too.
export default async function ChangeVenueBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getVenueBooking(id);
  const equipment = "booking" in result ? await getEventEquipmentRequests(result.booking.eventId) : null;

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        {"error" in result ? (
          <div className="alert alert--error" role="alert">{result.error}</div>
        ) : (
          <>
            <Link className="back-link" href={`/events/${result.booking.eventId}`}>← Back to event</Link>
            {isChangeableVenueBooking(result.booking.status) ? (
              <VenueBookingChangeForm booking={result.booking} equipment={equipmentFor(equipment?.requests ?? [], id)} />
            ) : (
              <div className="alert alert--error" role="alert">Only a pending or approved venue booking can be changed or cancelled.</div>
            )}
          </>
        )}
      </main>
    </>
  );
}
