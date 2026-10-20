import Link from "next/link";
import { describeFlag } from "@spm-t5/shared";
import { EmptyNote, EventSection } from "@/components/event/EventSection";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BOOKING_STATUS_DISPLAY, type BookingStatusKey } from "@/lib/status";
import { VenueBookingCancel } from "./VenueBookingCancel";
import type { EquipmentRequestView } from "@/lib/equipmentRequests";
import { bookingStatusLabel, equipmentFor, isChangeableVenueBooking, type EventVenueBookingItem } from "@/lib/venueBookings";

// SCRUM-98/AC5: every venue booking of the event, each with its venue, date, times and status, including rejected and
// withdrawn ones (98-S23). Shown to the assigned Coordinator only (venue-service answers nobody else); null means no
// section. Replaces SCRUM-38's single approved venue (38-S4): approved venue bookings are in this list too.
// SCRUM-102/AC1, AC2: while the event can still have venues (`canChange`), each pending or approved venue booking can be
// changed or cancelled; `equipment` is the event's equipment requests, so cancelling can say what it releases (AC7).
export function EventVenueBookings({
  bookings,
  canChange = false,
  equipment = [],
}: {
  bookings: EventVenueBookingItem[] | null;
  canChange?: boolean;
  equipment?: EquipmentRequestView[];
}) {
  if (!bookings) return null;
  return (
    <EventSection id="venue-bookings-heading" title="Venue bookings">
      {bookings.length === 0 ? (
        <EmptyNote>No venue has been requested for this event yet.</EmptyNote>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Venue</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Attendance</TableHead>
              <TableHead>Status</TableHead>
              {canChange && <TableHead><span className="visually-hidden">Actions</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {bookings.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-medium"><Link className="text-fg-primary underline-offset-4 hover:underline" href={`/venue-bookings/${b.id}`}>{b.venueName}</Link></TableCell>
                <TableCell>{b.date}</TableCell>
                <TableCell>{b.startTime}–{b.endTime}</TableCell>
                <TableCell className="whitespace-normal">
                  {b.expectedAttendance ?? "Not specified"}
                  {/* 98-S10: a warning, never a refusal; venue staff decide */}
                  {b.exceedsCapacity && <StatusBadge tone="warning" label="More people than this venue holds" className="mt-1 flex w-fit" />}
                </TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge {...BOOKING_STATUS_DISPLAY[b.status as BookingStatusKey]} label={bookingStatusLabel(b.status)} />
                    {b.flags.map((f) => (
                      <span className="text-xs font-medium text-status-warning-fg" key={f.id}>{describeFlag(f, b.venueName)}</span>
                    ))}
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
                    {/* SCRUM-113/AC1: back to Pending after an important change; venue staff decide again */}
                    {b.sentBackForReview && <span className="text-xs text-muted-foreground">Waiting for review again after an event change</span>}
                  </div>
                </TableCell>
                {canChange && (
                  <TableCell>
                    {isChangeableVenueBooking(b.status) && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href={`/venue-bookings/${b.id}/change`} aria-label={`Change the ${b.venueName} venue booking`}>
                          Change
                        </Link>
                        <VenueBookingCancel booking={b} equipment={equipmentFor(equipment, b.id)} />
                      </div>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </EventSection>
  );
}
