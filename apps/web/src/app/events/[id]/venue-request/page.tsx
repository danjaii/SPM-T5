import type { Metadata } from "next";
import { AuthAlert } from "@/components/auth/AuthParts";
import { VenueBookingRequestForm } from "@/components/VenueBookingRequestForm";
import { getVenueBookingForm } from "@/lib/venueBookingsServer";
import { BackLink, PAGE_MAIN } from "@/components/PageFrame";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Request a venue · ConnectSphere" };

// SCRUM-32: the assigned coordinator requests a venue for an approved event.
// SCRUM-133: inside the shared app shell, as a card; "Add venue" on the event's Venues tab comes here too.
export default async function VenueRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getVenueBookingForm(id);

  return (
    <main className={PAGE_MAIN}>
      <BackLink href={`/events/${id}?tab=venues`} to="event" />
      {"form" in result ? (
        <VenueBookingRequestForm form={result.form} venues={result.venues} />
      ) : (
        <AuthAlert tone="error">{result.error}</AuthAlert>
      )}
    </main>
  );
}
