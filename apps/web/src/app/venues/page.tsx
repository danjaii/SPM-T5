import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthAlert } from "@/components/auth/AuthParts";
import { VenueCatalogue } from "@/components/VenueCatalogue";
import { buttonVariants } from "@/components/ui/button";
import { getEvent } from "@/lib/getEvent";
import { getVenues } from "@/lib/getVenues";
import { cn } from "@/lib/utils";
import { canAddVenue } from "@/lib/venueCatalogueServer";
import { queryFromEvent } from "@/lib/venueFilters";
import { getVenueSearchOptions } from "@/lib/venueSearchServer";

// Rendered per request: what's shown depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Venue catalogue · ConnectSphere" };

// SCRUM-29: fetch the venue catalogue, then display it. SCRUM-129: inside the shared app shell, as a card list.
// SCRUM-131: the venue search is part of it. `?eventId=` opens it with that event's date, time, attendance and requirements.
export default async function VenuesPage({ searchParams }: { searchParams?: Promise<{ eventId?: string }> }) {
  const { eventId } = (await searchParams) ?? {};
  const result = await getVenues();
  // SCRUM-57/AC3: only Venue Staff are offered the add action (the service and the database refuse everyone else too).
  const canAdd = "venues" in result && (await canAddVenue());
  // A role that may not search gets an error here and simply sees the catalogue without the filters.
  const searchOptions = "venues" in result ? await getVenueSearchOptions() : undefined;
  const options = searchOptions && "options" in searchOptions ? searchOptions.options : undefined;
  const event = eventId && options ? await getEvent(eventId) : undefined;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Venue catalogue</h1>
          <p className="mt-1 text-sm text-muted-foreground">Browse ConnectSphere venues, or filter them to the ones free and suitable for an event.</p>
        </div>
        {canAdd && (
          <Link href="/venues/new" className={cn(buttonVariants())}>
            <Plus aria-hidden="true" />
            Add venue
          </Link>
        )}
      </div>
      {event && "error" in event && <div className="mb-4"><AuthAlert tone="error">{event.error}</AuthAlert></div>}
      {"venues" in result ? (
        <VenueCatalogue
          venues={result.venues}
          options={options}
          prefill={
            event && "event" in event && options
              ? { eventName: event.event.name, query: queryFromEvent(event.event, options), requirements: event.event.venue_requirements }
              : undefined
          }
        />
      ) : (
        // SCRUM-29 AC4/AC6/AC7: e.g. an organiser — show why, instead of the catalogue
        <AuthAlert tone="error">{result.error}</AuthAlert>
      )}
    </main>
  );
}
