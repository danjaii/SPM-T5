import type { Metadata } from "next";
import { AuthAlert } from "@/components/auth/AuthParts";
import { VenueForm } from "@/components/VenueForm";
import { canEditVenue, getVenueForEdit } from "@/lib/venueCatalogueServer";
import { getVenueSearchOptions } from "@/lib/venueSearchServer";
import { BackLink, PAGE_MAIN, PageTitle } from "@/components/PageFrame";

// Rendered per request: who may edit a venue depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Edit venue · ConnectSphere" };

// SCRUM-58: Venue Staff edit a venue, in the same form as adding one, filled in. Anyone else is told why they cannot (58-S3); the
// service and the database refuse them too.
export default async function EditVenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const allowed = await canEditVenue();
  // The form offers the same layouts and facilities as the venue search, so they are read from the same place.
  const [options, loaded] = allowed ? await Promise.all([getVenueSearchOptions(), getVenueForEdit(id)]) : [undefined, undefined];

  return (
    <main className={PAGE_MAIN}>
      <BackLink href={`/venues/${encodeURIComponent(id)}`} to="venue" />
      {!allowed ? (
        <>
          <PageTitle>Edit venue</PageTitle>
          <AuthAlert tone="error">Only venue staff can edit a venue.</AuthAlert>
        </>
      ) : loaded && "venue" in loaded && options && "options" in options ? (
        <>
          <PageTitle>Edit {loaded.venue.name}</PageTitle>
          <p className="text-sm text-muted-foreground">
            Changes appear in the catalogue as soon as they are saved. Setup and turnaround times are edited on the venue&rsquo;s page.
          </p>
          <VenueForm options={options.options} venueId={id} initial={loaded.venue} />
        </>
      ) : (
        <>
          <PageTitle>Edit venue</PageTitle>
          <AuthAlert tone="error">
            {loaded && "error" in loaded ? loaded.error : options && "error" in options ? options.error : "Something went wrong. Please try again."}
          </AuthAlert>
        </>
      )}
    </main>
  );
}
