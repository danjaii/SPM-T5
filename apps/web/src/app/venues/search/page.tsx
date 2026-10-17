import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { VenueSearchForm } from "@/components/VenueSearchForm";
import { getVenueSearchOptions } from "@/lib/venueSearchServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Search venues · ConnectSphere" };

// SCRUM-65: an Event Coordinator searches for venues that are free and meet an event's requirements.
export default async function VenueSearchPage() {
  const result = await getVenueSearchOptions();

  return (
    <>
      <AppHeader />
      <main className="dash__main">
        <Link className="back-link" href="/dashboard">← Back to dashboard</Link>
        <h1>Search venues</h1>
        <p className="dash__lede">Find venues that are free for your event&apos;s date and time and meet its requirements.</p>
        {"options" in result ? (
          <VenueSearchForm options={result.options} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
