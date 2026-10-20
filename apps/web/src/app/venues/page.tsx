import type { Metadata } from "next";
import { AuthAlert } from "@/components/auth/AuthParts";
import { VenueList } from "@/components/VenueList";
import { getVenues } from "@/lib/getVenues";

// Rendered per request: what's shown depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Venue catalogue · ConnectSphere" };

// SCRUM-29: fetch the venue catalogue, then display it. SCRUM-129: inside the shared app shell, as a card list.
export default async function VenuesPage() {
  const result = await getVenues();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Venue catalogue</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">Browse ConnectSphere venues and open one to see its details.</p>
      {"venues" in result ? (
        <VenueList venues={result.venues} />
      ) : (
        // SCRUM-29 AC4/AC6/AC7: e.g. an organiser — show why, instead of the catalogue
        <AuthAlert tone="error">{result.error}</AuthAlert>
      )}
    </main>
  );
}
