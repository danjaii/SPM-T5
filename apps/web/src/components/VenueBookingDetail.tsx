import Link from "next/link";
import { describeFlag } from "@spm-t5/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { BOOKING_STATUS_DISPLAY, type BookingStatusKey } from "@/lib/status";
import { bookingStatusLabel, type VenueBookingDetailView } from "@/lib/venueBookings";
import { FlagBadges } from "./FlagBadges";

const resolvedReasonLabel = (reason: string | null) =>
  reason === "replaced" ? "replaced by another venue" : reason === "booking_closed" ? "booking closed" : "no longer applies";

const linkClass =
  "font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring";

const statusBadge = (status: string | undefined) => (
  <StatusBadge {...(status ? BOOKING_STATUS_DISPLAY[status as BookingStatusKey] : undefined)} label={bookingStatusLabel(status)} />
);

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-base leading-snug font-bold">{title}</h2>
      </CardHeader>
      <CardContent className="text-sm">{children}</CardContent>
    </Card>
  );
}

// SCRUM-33/AC4: read-only view of one request: outcome, rejection reason, suggested alternative, amendment chain.
// SCRUM-135: the coordinator's copy of the request in the new style: cards, a StatusBadge, and the shared flag badges.
export function VenueBookingDetail({ booking }: { booking: VenueBookingDetailView }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{booking.eventName}</h1>
        {statusBadge(booking.status)}
      </div>

      {/* SCRUM-104/AC3: raised when the venue's setup or turnaround time was raised; change or cancel one booking to clear it */}
      {booking.flags.length > 0 && (
        <Alert aria-label="Flags">
          <FlagBadges flags={booking.flags} venueName={booking.venueName} label="" />
          <AlertDescription>Change or cancel this booking to resolve it.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">Request details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Fact label="Venue">{booking.venueName}</Fact>
            <Fact label="Date">{booking.date}</Fact>
            <Fact label="Time">{booking.startTime}–{booking.endTime}</Fact>
            <Fact label="Expected attendance">{booking.expectedAttendance ?? "Not specified"}</Fact>
            <Fact label="Venue requirements">{booking.venueRequirements || "None specified"}</Fact>
            <Fact label="Accessibility needs">{booking.accessibilityNeeds || "None specified"}</Fact>
          </dl>
        </CardContent>
      </Card>

      {/* SCRUM-107/AC3: the link between a flagged booking and its replacement, in words */}
      {booking.replacedBy && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span>{booking.status === "REPLACED" ? "Replaced by " : "Replacement request waiting for a decision: "}</span>
          <Link className={linkClass} href={`/venue-bookings/${booking.replacedBy.id}`}>
            {booking.replacedBy.venueName}, {booking.replacedBy.date} {booking.replacedBy.startTime}–{booking.replacedBy.endTime}
          </Link>
          {statusBadge(booking.replacedBy.status)}
        </p>
      )}
      {booking.replaces && (
        <p className="text-sm">
          Replaces{" "}
          <Link className={linkClass} href={`/venue-bookings/${booking.replaces.id}`}>
            {booking.replaces.venueName}, {booking.replaces.date} {booking.replaces.startTime}–{booking.replaces.endTime}
          </Link>
        </p>
      )}

      {booking.rejectionReason && (
        <Section title="Reason for rejection">
          <p>{booking.rejectionReason}</p>
        </Section>
      )}

      {booking.suggestion && (
        <Section title="Suggested alternative">
          <p>
            {booking.suggestion.venueName} on {booking.suggestion.date},{" "}
            {booking.suggestion.startTime}–{booking.suggestion.endTime}
          </p>
        </Section>
      )}

      {/* SCRUM-107/AC3: why it was flagged and how it ended stay visible after the take-over */}
      {booking.flagHistory && booking.flagHistory.some((f) => f.resolvedAt) && (
        <Section title="Flag history">
          <ul className="list-disc pl-4">
            {booking.flagHistory.map((f) => (
              <li key={f.id}>
                {f.unavailability ? describeFlag({ ...f, otherPeriod: null }, booking.venueName) : f.label}
                {": "}
                {f.resolvedAt ? `resolved (${resolvedReasonLabel(f.resolvedReason)})` : "open"}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {booking.chain.length > 1 && (
        <Section title="Amendment history">
          <ol className="flex flex-col gap-3">
            {booking.chain.map((c) => (
              <li key={c.id} className="flex flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  {c.id === booking.id ? (
                    <strong>{c.venueName}, {c.date} {c.startTime}–{c.endTime}</strong>
                  ) : (
                    <Link className={linkClass} href={`/venue-bookings/${c.id}`}>{c.venueName}, {c.date} {c.startTime}–{c.endTime}</Link>
                  )}
                  {statusBadge(c.status)}
                </span>
                {c.rejectionReason && <span className="text-muted-foreground">{c.rejectionReason}</span>}
              </li>
            ))}
          </ol>
        </Section>
      )}
    </section>
  );
}
