import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { VenueAvailabilityDay } from "@/components/VenueAvailabilityDay";
import { todaySgt } from "@/lib/venueAvailability";
import { getVenueAvailability } from "@/lib/venueAvailabilityServer";

// Rendered per request: what is booked changes, and who may see it depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Venue availability · ConnectSphere" };

// SCRUM-103/AC5: one day of a venue's availability, with setup and turnaround shown apart from the event.
export default async function VenueAvailabilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { id } = await params;
  const { date } = await searchParams;
  const result = await getVenueAvailability(id, date || todaySgt());

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href={`/venues/${id}`}>← Back to venue details</Link>
        {"data" in result ? (
          <VenueAvailabilityDay data={result.data} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
