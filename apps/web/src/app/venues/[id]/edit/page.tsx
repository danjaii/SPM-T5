import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthAlert } from "@/components/auth/AuthParts";
import { VenueForm } from "@/components/VenueForm";
import { canEditVenue, getVenueForEdit } from "@/lib/venueCatalogueServer";
import { getVenueSearchOptions } from "@/lib/venueSearchServer";

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
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8 md:px-8">
      <Link
        href={`/venues/${encodeURIComponent(id)}`}
        className="flex w-fit items-center gap-1.5 text-sm font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to venue
      </Link>
      {!allowed ? (
        <>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Edit venue</h1>
          <AuthAlert tone="error">Only venue staff can edit a venue.</AuthAlert>
        </>
      ) : loaded && "venue" in loaded && options && "options" in options ? (
        <>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Edit {loaded.venue.name}</h1>
          <p className="text-sm text-muted-foreground">
            Changes appear in the catalogue as soon as they are saved. Setup and turnaround times are edited on the venue&rsquo;s page.
          </p>
          <VenueForm options={options.options} venueId={id} initial={loaded.venue} />
        </>
      ) : (
        <>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Edit venue</h1>
          <AuthAlert tone="error">
            {loaded && "error" in loaded ? loaded.error : options && "error" in options ? options.error : "Something went wrong. Please try again."}
          </AuthAlert>
        </>
      )}
    </main>
  );
}
