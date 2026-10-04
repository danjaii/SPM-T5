import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { VenueBookingAmendForm } from "@/components/VenueBookingAmendForm";
import { getVenueBooking, getVenueBookingForm } from "@/lib/venueBookingsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Amend venue request · ConnectSphere" };

// SCRUM-60: amend a rejected request. The event's current details come from the request form endpoint.
export default async function AmendVenueBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await getVenueBooking(id);
  const form = "booking" in booking ? await getVenueBookingForm(booking.booking.eventId) : undefined;

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href={`/venue-bookings/${id}`}>← Back to the request</Link>
        {"error" in booking ? (
          <div className="alert alert--error" role="alert">{booking.error}</div>
        ) : form && "error" in form ? (
          <div className="alert alert--error" role="alert">{form.error}</div>
        ) : form ? (
          <VenueBookingAmendForm rejected={booking.booking} form={form.form} venues={form.venues} />
        ) : null}
      </main>
    </>
  );
}
