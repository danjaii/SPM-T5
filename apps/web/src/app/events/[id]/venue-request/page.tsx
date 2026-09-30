import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { VenueBookingRequestForm } from "@/components/VenueBookingRequestForm";
import { getVenueBookingForm } from "@/lib/venueBookings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Request a venue · ConnectSphere" };

// SCRUM-32: the assigned coordinator requests a venue for an approved event.
export default async function VenueRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getVenueBookingForm(id);

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href={`/events/${id}`}>← Back to event</Link>
        {"form" in result ? (
          <VenueBookingRequestForm form={result.form} venues={result.venues} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
