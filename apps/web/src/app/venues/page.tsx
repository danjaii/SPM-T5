import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { VenueList } from "@/components/VenueList";
import { getVenues } from "@/lib/getVenues";

// Rendered per request: what's shown depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Venue catalogue · ConnectSphere" };

// SCRUM-29: fetch the venue catalogue, then display it
export default async function VenuesPage() {
  const result = await getVenues();

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href="/dashboard">← Back to dashboard</Link>
        <h1>Venue catalogue</h1>
        <p className="dash__lede">Browse ConnectSphere venues and open one to see its details.</p>
        {"venues" in result ? (
          <VenueList venues={result.venues} />
        ) : (
          // SCRUM-29 AC4/AC6/AC7: e.g. an organiser — show why, instead of the catalogue
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
