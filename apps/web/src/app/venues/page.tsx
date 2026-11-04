import { LayoutGrid, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthAlert } from "@/components/auth/AuthParts";
import { PageFrame } from "@/components/PageFrame";
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
// SCRUM-186/AC1, AC5: the shared page frame.
export default async function VenuesPage({ searchParams }: { searchParams?: Promise<{ eventId?: string }> }) {
  const { eventId } = (await searchParams) ?? {};
  // SCRUM-29 AC4/AC6/AC7: a role that may not see the catalogue (e.g. an organiser) gets the reason instead
  const result = await getVenues();
  // SCRUM-57/AC3: only Venue Staff are offered the add action (the service and the database refuse everyone else too).
  const canAdd = "venues" in result && (await canAddVenue());
  // A role that may not search gets an error here and simply sees the catalogue without the filters.
  const searchOptions = "venues" in result ? await getVenueSearchOptions() : undefined;
  const options = searchOptions && "options" in searchOptions ? searchOptions.options : undefined;
  const event = eventId && options ? await getEvent(eventId) : undefined;

  return (
    <PageFrame
      title="Venue catalogue"
      description="Browse ConnectSphere venues, or filter them to the ones free and suitable for an event."
      error={"venues" in result ? undefined : result.error}
      action={
        canAdd && (
          <div className="flex flex-wrap gap-2">
            {/* SCRUM-181/AC6: the layout types are offered to Venue Staff only, like the add action. */}
            <Link href="/venues/layout-types" className={cn(buttonVariants({ variant: "outline" }))}>
              <LayoutGrid aria-hidden="true" />
              Layout types
            </Link>
            <Link href="/venues/new" className={cn(buttonVariants())}>
              <Plus aria-hidden="true" />
              Add venue
            </Link>
          </div>
        )
      }
    >
      {event && "error" in event && <AuthAlert tone="error">{event.error}</AuthAlert>}
      {"venues" in result && (
        <VenueCatalogue
          venues={result.venues}
          options={options}
          prefill={
            event && "event" in event && options
              ? { eventName: event.event.name, query: queryFromEvent(event.event, options), requirements: event.event.venue_requirements }
              : undefined
          }
        />
      )}
    </PageFrame>
  );
}
