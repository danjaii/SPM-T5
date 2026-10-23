import Link from "next/link";
import { describeFlag } from "@spm-t5/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { canReplaceVenue, isAffected, replacementHref } from "@/lib/affectedBookings";
import { cn } from "@/lib/utils";
import type { EventVenueBookingItem } from "@/lib/venueBookings";

// SCRUM-135 (Figma frame 06): the top of an event page says when a venue booking needs attention, what is wrong, that the booking
// and event are kept, and where to fix it. Nothing renders when no booking is flagged.
export function NeedsAttentionBanner({ bookings }: { bookings: EventVenueBookingItem[] }) {
  const affected = bookings.filter(isAffected);
  if (affected.length === 0) return null;
  return (
    <Alert data-testid="needs-attention-banner">
      <AlertTitle>
        {affected.length === 1 ? `${affected[0].venueName} needs attention` : `${affected.length} venue bookings need attention`}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        {affected.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {b.venueName}: {b.flags.map((f) => describeFlag(f, b.venueName)).join(". ")}. The booking and event details are kept.
            </span>
            {canReplaceVenue(b) ? (
              <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href={replacementHref(b.id)}>
                Find replacement venue
              </Link>
            ) : (
              <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href={`/venue-bookings/${b.id}`}>
                View booking
              </Link>
            )}
          </div>
        ))}
      </AlertDescription>
    </Alert>
  );
}
