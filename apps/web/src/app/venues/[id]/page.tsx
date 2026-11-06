import type { Metadata } from "next";
import { AuthAlert } from "@/components/auth/AuthParts";
import { VenueDetail } from "@/components/VenueDetail";
import { getVenue } from "@/lib/getVenues";
import { BackLink, PAGE_MAIN } from "@/components/PageFrame";

// Rendered per request: what's shown depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Venue details · ConnectSphere" };

// SCRUM-29 AC2: fetch the venue that was clicked (its id is in the address), then display its details.
export default async function VenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getVenue(id);

  return (
    <main className={PAGE_MAIN}>
      <BackLink href="/venues" to="venue catalogue" />
      {"venue" in result ? (
        <VenueDetail venue={result.venue} />
      ) : (
        // SCRUM-29 AC4/AC6/AC7 (e.g. an organiser) or an unknown venue — show why, instead of the details
        <AuthAlert tone="error">{result.error}</AuthAlert>
      )}
    </main>
  );
}
