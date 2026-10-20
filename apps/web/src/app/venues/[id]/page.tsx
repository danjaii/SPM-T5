import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthAlert } from "@/components/auth/AuthParts";
import { VenueDetail } from "@/components/VenueDetail";
import { getVenue } from "@/lib/getVenues";

// Rendered per request: what's shown depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Venue details · ConnectSphere" };

// SCRUM-29 AC2: fetch the venue that was clicked (its id is in the address), then display its details.
export default async function VenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getVenue(id);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 md:px-8">
      <Link
        href="/venues"
        className="flex w-fit items-center gap-1.5 text-sm font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to venue catalogue
      </Link>
      {"venue" in result ? (
        <VenueDetail venue={result.venue} />
      ) : (
        // SCRUM-29 AC4/AC6/AC7 (e.g. an organiser) or an unknown venue — show why, instead of the details
        <AuthAlert tone="error">{result.error}</AuthAlert>
      )}
    </main>
  );
}
