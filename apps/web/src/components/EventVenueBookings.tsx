import Link from "next/link";
import { EmptyNote, EventSection } from "@/components/event/EventSection";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { holdCountdown } from "@/lib/holds";
import type { EquipmentRequestView } from "@/lib/equipmentRequests";
import type { EventVenueBookingItem } from "@/lib/venueBookings";
import { ExpiredHold, VenueBookingCard } from "./VenueBookingCard";

// SCRUM-98/AC5: every venue booking of the event, each with its venue, date, times and status, including rejected and
// withdrawn ones (98-S23). Shown to the assigned Coordinator only (venue-service answers nobody else); null means no
// section. Replaces SCRUM-38's single approved venue (38-S4): approved venue bookings are in this list too.
// SCRUM-102/AC1, AC2: while the event can still have venues (`canChange`), each pending or approved venue booking can be
// changed or cancelled; `equipment` is the event's equipment requests, so cancelling can say what it releases (AC7).
// SCRUM-133/AC1: one card per booking, each with its own status; AC3: a lapsed hold is a separate Expired row, not a card.
export function EventVenueBookings({
  bookings,
  canChange = false,
  equipment = [],
  now = new Date(),
  requestHref,
}: {
  bookings: EventVenueBookingItem[] | null;
  canChange?: boolean;
  equipment?: EquipmentRequestView[];
  now?: Date;
  /** Where "Add venue" goes; left out when the event cannot have another venue. */
  requestHref?: string;
}) {
  if (!bookings) return null;
  const isExpiredHold = (b: EventVenueBookingItem) =>
    b.status === "PENDING" && !!b.holdExpiresAt && holdCountdown(b.holdExpiresAt, now).state === "expired";
  const live = bookings.filter((b) => !isExpiredHold(b));
  const expired = bookings.filter(isExpiredHold);
  return (
    <EventSection
      id="venue-bookings-heading"
      title="Venue bookings"
      action={
        <div className="flex items-center gap-3">
          {live.length > 0 && (
            <span className="text-sm text-muted-foreground">{live.length} {live.length === 1 ? "space" : "spaces"}, each checked separately</span>
          )}
          {requestHref && (
            <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href={requestHref}>+ Add venue</Link>
          )}
        </div>
      }
    >
      {bookings.length === 0 ? (
        <EmptyNote>No venue has been requested for this event yet.</EmptyNote>
      ) : (
        <>
          <ul className="grid gap-4 md:grid-cols-2">
            {live.map((b) => (
              <li key={b.id} className="flex">
                <VenueBookingCard booking={b} now={now} canChange={canChange} equipment={equipment} />
              </li>
            ))}
          </ul>
          {expired.map((b) => <ExpiredHold key={b.id} booking={b} />)}
        </>
      )}
    </EventSection>
  );
}
