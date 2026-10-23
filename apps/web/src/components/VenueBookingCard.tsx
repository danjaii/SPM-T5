import Link from "next/link";
import { Building2, History } from "lucide-react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { holdCountdown } from "@/lib/holds";
import { BOOKING_STATUS_DISPLAY, type BookingStatusKey } from "@/lib/status";
import type { EquipmentRequestView } from "@/lib/equipmentRequests";
import { bookingStatusLabel, equipmentFor, isChangeableVenueBooking, type EventVenueBookingItem } from "@/lib/venueBookings";
import { FlagBadges } from "./FlagBadges";
import { VenueBookingCancel } from "./VenueBookingCancel";

const longDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const expiryText = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * SCRUM-133/AC3: a hold that has lapsed. A quiet struck-through row with the Expired badge, so it can never be read as a
 * confirmed booking (it is not a card, and it has no actions).
 */
export function ExpiredHold({ booking }: { booking: EventVenueBookingItem }) {
  return (
    <div data-testid="expired-hold" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border-strong px-4 py-3">
      <div className="flex items-center gap-3">
        <History aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium text-muted-foreground line-through">{booking.venueName} · hold</p>
          <p className="text-xs text-muted-foreground line-through">
            Expired {booking.holdExpiresAt ? expiryText(booking.holdExpiresAt) : ""} · not a booking
          </p>
        </div>
      </div>
      <StatusBadge {...BOOKING_STATUS_DISPLAY.EXPIRED} />
    </div>
  );
}

// SCRUM-133/AC1: one card for each venue booking, with its own status and its own actions. Everything the old table row
// showed is here (attendance warning, flags, replacement links, reasons, the sent-back note), so nothing is lost.
// AC2: a hold shows a countdown, in the warning tone with the "Hold expiring" label within 24 hours.
export function VenueBookingCard({
  booking: b,
  now,
  canChange,
  equipment,
}: {
  booking: EventVenueBookingItem;
  now: Date;
  canChange: boolean;
  equipment: EquipmentRequestView[];
}) {
  const hold = b.holdExpiresAt && b.status === "PENDING" ? holdCountdown(b.holdExpiresAt, now) : undefined;
  const badge =
    hold?.state === "expiring"
      ? { tone: "warning" as const, label: "Hold expiring" }
      : hold
        ? BOOKING_STATUS_DISPLAY.HOLD
        : { ...BOOKING_STATUS_DISPLAY[b.status as BookingStatusKey], label: bookingStatusLabel(b.status) };
  const flagged = b.flags.length > 0;

  return (
    <Card data-testid="venue-booking-card" className={cn("gap-3 p-4", flagged && "ring-2 ring-status-warning-fg")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-status-info text-status-info-fg">
            <Building2 aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold">
              <Link className="text-fg-primary underline-offset-4 hover:underline" href={`/venue-bookings/${b.id}`}>{b.venueName}</Link>
            </h3>
            <p className="text-xs text-muted-foreground">
              {b.venueRequirements ? `${b.venueRequirements} · ` : ""}
              {b.expectedAttendance !== null ? `${b.expectedAttendance} people` : "Attendance not specified"}
            </p>
          </div>
        </div>
        <StatusBadge {...badge} />
      </div>

      <p className="text-sm">
        {longDate(b.date)} · {b.startTime}–{b.endTime}
      </p>

      {/* 98-S10: a warning, never a refusal; venue staff decide */}
      {b.exceedsCapacity && <StatusBadge tone="warning" label="More people than this venue holds" className="flex w-fit" />}

      {hold && b.holdExpiresAt && (
        <p
          data-testid="hold-countdown"
          data-state={hold.state}
          className={cn("rounded-lg px-3 py-2 text-sm", hold.state === "expiring" ? "bg-status-warning text-status-warning-fg" : "bg-status-info text-status-info-fg")}
        >
          Tentative hold expires {expiryText(b.holdExpiresAt)} ({hold.remaining}). If not confirmed, the room is released.
        </p>
      )}

      {(flagged || b.replacedBy || b.replaces || b.rejectionReason || b.cancellationReason || b.sentBackForReview) && (
        <div className="flex flex-col gap-1">
          <FlagBadges flags={b.flags} venueName={b.venueName} />
          {/* SCRUM-107/AC3: the original keeps its place, with where it went; the replacement says what it replaced */}
          {b.replacedBy && (
            <span className="text-xs text-muted-foreground">
              {b.status === "REPLACED" ? "Replaced by " : "Replacement waiting: "}
              <Link className="underline" href={`/venue-bookings/${b.replacedBy.id}`}>{b.replacedBy.venueName}</Link>
            </span>
          )}
          {b.replaces && (
            <span className="text-xs text-muted-foreground">
              Replaces <Link className="underline" href={`/venue-bookings/${b.replaces.id}`}>{b.replaces.venueName}</Link>
            </span>
          )}
          {b.rejectionReason && <span className="text-xs text-muted-foreground">{b.rejectionReason}</span>}
          {b.cancellationReason && <span className="text-xs text-muted-foreground">{b.cancellationReason}</span>}
          {/* SCRUM-113/AC1: back to Pending after an important event change; venue staff decide again */}
          {b.sentBackForReview && <span className="text-xs text-muted-foreground">Waiting for review again after an event change</span>}
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-1">
        <Link className={cn(buttonVariants({ variant: "ghost", size: "sm" }))} href={`/venue-bookings/${b.id}`} aria-label={`View the ${b.venueName} venue booking`}>
          View booking
        </Link>
        {canChange && isChangeableVenueBooking(b.status) && (
          <>
            <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href={`/venue-bookings/${b.id}/change`} aria-label={`Change the ${b.venueName} venue booking`}>
              Change
            </Link>
            <VenueBookingCancel booking={b} equipment={equipmentFor(equipment, b.id)} />
          </>
        )}
      </div>
    </Card>
  );
}
