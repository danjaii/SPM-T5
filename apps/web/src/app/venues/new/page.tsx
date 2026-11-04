import type { Metadata } from "next";
import { AuthAlert } from "@/components/auth/AuthParts";
import { VenueForm } from "@/components/VenueForm";
import { canAddVenue } from "@/lib/venueCatalogueServer";
import { getVenueSearchOptions } from "@/lib/venueSearchServer";
import { BackLink, PAGE_MAIN, PageTitle } from "@/components/PageFrame";

// Rendered per request: who may add a venue depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Add a venue · ConnectSphere" };

// SCRUM-57: Venue Staff add a venue. Anyone else is told why they cannot (57-S3); the service and the database refuse them too.
export default async function NewVenuePage() {
  const allowed = await canAddVenue();
  // The form offers the same layouts and facilities as the venue search, so they are read from the same place.
  const loaded = allowed ? await getVenueSearchOptions() : undefined;

  return (
    <main className={PAGE_MAIN}>
      <BackLink href="/venues" to="venue catalogue" />
      <PageTitle>Add a venue</PageTitle>
      {!allowed ? (
        <AuthAlert tone="error">Only venue staff can add a venue.</AuthAlert>
      ) : loaded && "options" in loaded ? (
        <>
          <p className="text-sm text-muted-foreground">
            The venue appears in the catalogue as soon as it is added. Setup and turnaround times start at 0 and can be set on the venue&rsquo;s page.
          </p>
          <VenueForm options={loaded.options} />
        </>
      ) : (
        <AuthAlert tone="error">{loaded && "error" in loaded ? loaded.error : "Something went wrong. Please try again."}</AuthAlert>
      )}
    </main>
  );
}
