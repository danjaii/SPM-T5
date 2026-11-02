import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthAlert } from "@/components/auth/AuthParts";
import { VenueForm } from "@/components/VenueForm";
import { canAddVenue } from "@/lib/venueCatalogueServer";
import { getVenueSearchOptions } from "@/lib/venueSearchServer";

// Rendered per request: who may add a venue depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Add a venue · ConnectSphere" };

// SCRUM-57: Venue Staff add a venue. Anyone else is told why they cannot (57-S3); the service and the database refuse them too.
export default async function NewVenuePage() {
  const allowed = await canAddVenue();
  // The form offers the same layouts and facilities as the venue search, so they are read from the same place.
  const loaded = allowed ? await getVenueSearchOptions() : undefined;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8 md:px-8">
      <Link
        href="/venues"
        className="flex w-fit items-center gap-1.5 text-sm font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to venue catalogue
      </Link>
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Add a venue</h1>
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
