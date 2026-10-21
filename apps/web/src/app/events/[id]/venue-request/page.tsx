import type { Metadata } from "next";
import Link from "next/link";
import { AuthAlert } from "@/components/auth/AuthParts";
import { VenueBookingRequestForm } from "@/components/VenueBookingRequestForm";
import { getVenueBookingForm } from "@/lib/venueBookingsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Request a venue · ConnectSphere" };

// SCRUM-32: the assigned coordinator requests a venue for an approved event.
// SCRUM-133: inside the shared app shell, as a card; "Add venue" on the event's Venues tab comes here too.
export default async function VenueRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getVenueBookingForm(id);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
      <Link className="mb-4 inline-block text-sm font-medium text-fg-primary hover:underline" href={`/events/${id}?tab=venues`}>← Back to event</Link>
      {"form" in result ? (
        <VenueBookingRequestForm form={result.form} venues={result.venues} />
      ) : (
        <AuthAlert tone="error">{result.error}</AuthAlert>
      )}
    </main>
  );
}
