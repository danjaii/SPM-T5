import Link from "next/link";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { canReplaceVenue, isAffected, replacementHref } from "@/lib/affectedBookings";
import { cn } from "@/lib/utils";
import type { VenueBookingListItem } from "@/lib/venueBookings";
import { FlagBadges } from "./FlagBadges";

const longDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// SCRUM-135/AC2, AC3 (Figma frame 16): the coordinator's home lists every booking a venue change has put in doubt, with the reason
// and a way to fix it. The bookings are kept; this list only points at them. AC10: empty and failed states are written out.
export function AffectedBookings({ bookings, error }: { bookings?: VenueBookingListItem[]; error?: string }) {
  const affected = (bookings ?? []).filter(isAffected);
  return (
    <section className="dash__section" aria-labelledby="affected-bookings-heading">
      <h2 id="affected-bookings-heading">Affected bookings</h2>
      {error ? (
        <div className="alert alert--error" role="alert">{error}</div>
      ) : affected.length === 0 ? (
        <p className="empty">No bookings need attention.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {affected.map((b) => (
            <li key={b.id}>
              <Card data-testid="affected-booking" className="gap-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold">
                      <Link className="text-fg-primary underline-offset-4 hover:underline" href={`/events/${b.eventId}?tab=venues`}>{b.eventName}</Link>
                    </h3>
                    <p className="text-xs text-muted-foreground">{b.venueName} · {longDate(b.date)} · {b.startTime}–{b.endTime}</p>
                  </div>
                  {canReplaceVenue(b) ? (
                    <Link className={cn(buttonVariants({ size: "sm" }))} href={replacementHref(b.id)} aria-label={`Find replacement venue for ${b.eventName} at ${b.venueName}`}>
                      Find replacement venue
                    </Link>
                  ) : (
                    <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href={`/venue-bookings/${b.id}`} aria-label={`View the ${b.venueName} booking for ${b.eventName}`}>
                      View booking
                    </Link>
                  )}
                </div>
                <FlagBadges flags={b.flags} venueName={b.venueName} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
