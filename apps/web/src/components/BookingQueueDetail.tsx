import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { unavailabilityFlagText } from "@spm-t5/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { SentBackNotice } from "./SentBackNotice";
import { formatSgt, occupiedWindow, suitabilityLabel, timingNote, type QueueDetailView } from "@/lib/bookingQueue";
import { BOOKING_STATUS_DISPLAY, type BookingStatusKey } from "@/lib/status";
import { bookingStatusLabel } from "@/lib/venueBookings";

const linkClass =
  "font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

// SCRUM-37/AC6: one request, whatever its status. A decided one also shows who decided it, when, and why.
// SCRUM-134: laid out as cards in the new style; AC1 the time shown includes setup and turnaround; AC6 statuses are StatusBadges.
export function BookingQueueDetail({ booking }: { booking: QueueDetailView }) {
  const note = timingNote(booking);
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{booking.eventName}</h1>
        <StatusBadge {...(booking.status ? BOOKING_STATUS_DISPLAY[booking.status as BookingStatusKey] : undefined)} label={bookingStatusLabel(booking.status)} />
      </div>
      <SentBackNotice note={booking.sentBack} />

      {/* SCRUM-104/AC4: why Approve is missing, and the booking it clashes with */}
      {booking.flags.length > 0 && (
        <div
          aria-label="Flags"
          className="flex items-start gap-2 rounded-lg border border-status-warning-fg bg-status-warning p-3 text-sm text-status-warning-fg"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <div>
            <strong>Flagged: {booking.flags.map((f) => f.label).join(", ")}</strong>
            <ul className="mt-1 list-disc pl-4">
              {booking.flags.map((f) => (
                <li key={f.id}>
                  {f.otherBookingId ? (
                    <Link href={`/booking-queue/${f.otherBookingId}`} className={linkClass}>{f.otherEventName ?? "Another booking"}</Link>
                  ) : f.unavailability ? null : (
                    f.label
                  )}
                  {f.otherPeriod && <> at this venue, {f.otherPeriod.date} {f.otherPeriod.startTime}–{f.otherPeriod.endTime}</>}
                  {/* SCRUM-106/AC3: the block that raised it, in words */}
                  {f.unavailability && <>{unavailabilityFlagText(f.unavailability, booking.venueName)}</>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">Request details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Fact label="Venue">{booking.venueName}</Fact>
            <Fact label="Date">{booking.date}</Fact>
            <Fact label="Event time">{booking.startTime}–{booking.endTime}</Fact>
            <Fact label="Venue occupied">
              {occupiedWindow(booking)}
              {note && <span className="text-muted-foreground"> ({note})</span>}
            </Fact>
            <Fact label="Expected attendance">{booking.expectedAttendance ?? "Not specified"}</Fact>
            <Fact label="Suitability">{suitabilityLabel(booking.suitability)}</Fact>
            <Fact label="Venue requirements">{booking.venueRequirements || "None specified"}</Fact>
            <Fact label="Accessibility needs">{booking.accessibilityNeeds || "None specified"}</Fact>
            <Fact label="Requested by">{booking.requestedByName ?? "Unknown"}</Fact>
            <Fact label="Submitted">{formatSgt(booking.submittedAt)}</Fact>
            {booking.decidedAt && (
              <>
                <Fact label="Decided by">{booking.decidedByName ?? "Unknown"}</Fact>
                <Fact label="Decided">{formatSgt(booking.decidedAt)}</Fact>
              </>
            )}
          </dl>
        </CardContent>
      </Card>

      {booking.suitability === "not_suitable" && (
        <Card aria-label="Requirements not met">
          <CardHeader>
            <CardTitle className="text-base font-bold">Requirements not met</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <ul className="list-disc pl-4">
              {booking.suitabilityUnmet.map((u) => (
                <li key={u.key}>
                  <strong>{u.label}:</strong> {u.message}
                </li>
              ))}
            </ul>
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground">Coordinator&apos;s reason</h3>
              <p>{booking.suitabilityOverrideReason}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {booking.rejectionReason && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-bold">Reason for rejection</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">{booking.rejectionReason}</CardContent>
        </Card>
      )}

      {booking.amendsRequestId && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge tone="info" label="Amends an earlier request" />
          <Link href={`/booking-queue/${booking.amendsRequestId}`} className={linkClass}>View the earlier request</Link>
        </p>
      )}
    </section>
  );
}
