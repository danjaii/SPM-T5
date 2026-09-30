import { utcToSgt, type VenueBookingStatus } from "@spm-t5/shared";

// Browser-safe types and helpers for the Venue Staff queue (SCRUM-37). The fetchers that read the
// session cookie live in ./bookingQueueServer.

/** A row in the pending request queue: GET /booking-queue. Date and times are Singapore time. */
export interface QueueItemView {
  id: string;
  venueId: string;
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
  eventName: string;
  expectedAttendance: number | null;
  venueRequirements: string | null;
  accessibilityNeeds: string | null;
  requestedByName: string | null;
  submittedAt: string;
  /** Set when this request amends an earlier, rejected one (37-S4). */
  amendsRequestId: string | null;
}

/** One request in any status: GET /booking-queue/:id. */
export interface QueueDetailView extends QueueItemView {
  status: VenueBookingStatus | undefined;
  decidedByName: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  suggestion: null;
}

/** An instant as Singapore "YYYY-MM-DD HH:MM". */
export function formatSgt(iso: string): string {
  const { date, time } = utcToSgt(new Date(iso));
  return `${date} ${time}`;
}
