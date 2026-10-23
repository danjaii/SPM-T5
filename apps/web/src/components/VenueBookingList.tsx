import Link from "next/link";
import { Inbox } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BOOKING_STATUS_DISPLAY, type BookingStatusKey } from "@/lib/status";
import { bookingStatusLabel, type VenueBookingListItem } from "@/lib/venueBookings";
import { FlagBadges } from "./FlagBadges";

const formatDecided = (iso: string) =>
  new Date(iso).toLocaleDateString("en-SG", { dateStyle: "medium", timeZone: "Asia/Singapore" });

// SCRUM-33/AC1: the coordinator's requests, with status and (for decided ones only) the decision date.
// SCRUM-135: in the new style. The status is a StatusBadge (icon and label); below the md breakpoint each row stacks into a
// card so nothing scrolls sideways; an empty list is a designed empty state.
export function VenueBookingList({ bookings }: { bookings: VenueBookingListItem[] }) {
  if (bookings.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
        <Inbox aria-hidden="true" className="size-8 text-muted-foreground" />
        <p className="font-semibold text-foreground">You have no venue booking requests.</p>
        <p className="text-sm text-muted-foreground">Requests you send to venue staff will show up here.</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader className="max-md:sr-only">
        <TableRow>
          <TableHead>Event</TableHead>
          <TableHead>Venue</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Time</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Decided</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {bookings.map((b) => (
          <TableRow key={b.id} className="max-md:flex max-md:flex-col max-md:gap-1 max-md:p-3">
            <TableCell className="whitespace-normal max-md:p-0">
              <Link
                href={`/venue-bookings/${b.id}`}
                className="font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
              >
                {b.eventName}
              </Link>
            </TableCell>
            <TableCell className="whitespace-normal max-md:p-0">{b.venueName}</TableCell>
            <TableCell className="max-md:p-0">{b.date}</TableCell>
            <TableCell className="max-md:p-0">{b.startTime}–{b.endTime}</TableCell>
            <TableCell className="whitespace-normal max-md:p-0">
              <div className="flex flex-col items-start gap-1.5">
                <StatusBadge {...(b.status ? BOOKING_STATUS_DISPLAY[b.status as BookingStatusKey] : undefined)} label={bookingStatusLabel(b.status)} />
                {/* SCRUM-104/AC3: the flag and the other booking's time, as text */}
                <FlagBadges flags={b.flags} venueName={b.venueName} />
              </div>
            </TableCell>
            <TableCell className="max-md:p-0">
              {(b.status === "APPROVED" || b.status === "REJECTED") && b.decidedAt ? formatDecided(b.decidedAt) : ""}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
