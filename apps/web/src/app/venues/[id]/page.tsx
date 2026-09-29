import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { VenueDetail } from "@/components/VenueDetail";
import { getVenue } from "@/lib/getVenues";

// Rendered per request: what's shown depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Venue details · ConnectSphere" };

// SCRUM-29 AC2: fetch the venue that was clicked (its id is in the address), then display its details
export default async function VenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getVenue(id);

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href="/venues">← Back to venue catalogue</Link>
        {"venue" in result ? (
          <VenueDetail venue={result.venue} />
        ) : (
          // for venue details, if not allowed to see or venue not available, we show nicely to user the error
          // SCRUM-29 AC4 (e.g. an organiser) or an unknown venue — show why, instead of the details
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
