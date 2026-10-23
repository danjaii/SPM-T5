import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import { AuthAlert } from "@/components/auth/AuthParts";
import { FlagBadges } from "@/components/FlagBadges";
import { ReplacementPicker } from "@/components/ReplacementPicker";
import { Card, CardContent } from "@/components/ui/card";
import { getReplacementCandidates, getVenueBooking } from "@/lib/venueBookingsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Find a replacement venue · ConnectSphere" };

// SCRUM-107/AC1: the venues that could replace a booking flagged as unavailable. venue-service refuses a booking that is not
// flagged, one that already has a replacement waiting, and anyone but the event's assigned coordinator; the reason is shown.
// SCRUM-135/AC3: in the new style (shared shell, cards, shadcn table). The page says which booking is being replaced and why.
export default async function ReplacementVenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await getVenueBooking(id);
  const options = "booking" in booking ? await getReplacementCandidates(id) : undefined;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
      <Link
        href={`/venue-bookings/${id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> Back to the booking
      </Link>
      <h1 className="mb-4 text-3xl font-bold tracking-tight text-foreground">Find a replacement venue</h1>
      {"error" in booking ? (
        <AuthAlert tone="error">{booking.error}</AuthAlert>
      ) : options && "error" in options ? (
        <AuthAlert tone="error">{options.error}</AuthAlert>
      ) : options ? (
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-status-info text-status-info-fg">
                  <Building2 aria-hidden="true" className="size-5" />
                </span>
                <p className="text-sm">
                  {booking.booking.eventName} is booked at {booking.booking.venueName} on {booking.booking.date},{" "}
                  {booking.booking.startTime}–{booking.booking.endTime}, which is no longer available. These venues are free for the
                  same period, including setup and turnaround, and hold at least {booking.booking.expectedAttendance ?? "the"} people.
                  Date, time, attendance and requirements are copied from this booking.
                </p>
              </div>
              <FlagBadges flags={booking.booking.flags} venueName={booking.booking.venueName} />
            </CardContent>
          </Card>
          <ReplacementPicker originalId={id} candidates={options.candidates} />
        </div>
      ) : null}
    </main>
  );
}
