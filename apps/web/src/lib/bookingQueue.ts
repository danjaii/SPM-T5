import { utcToSgt, type FlagDto, type SentBackNote, type UnmetRequirement, type VenueBookingStatus } from "@spm-t5/shared";

// Browser-safe types and helpers for the Venue Staff queue (SCRUM-37). The fetchers that read the
// session cookie live in ./bookingQueueServer.

/** A row in the pending request queue: GET /booking-queue. Date and times are Singapore time. */
export interface QueueItemView {
  id: string;
  /** The event the request is for (SCRUM-109). */
  eventId: string;
  venueId: string;
  venueName: string;
  /** SCRUM-134/AC1: whole minutes the venue needs before and after the event. */
  setupMinutes: number;
  turnaroundMinutes: number;
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
  /** SCRUM-110: the check as it was at submission; null for requests made before it existed. */
  suitability: "suitable" | "not_suitable" | null;
  suitabilityUnmet: UnmetRequirement[];
  suitabilityOverrideReason: string | null;
  /** SCRUM-104: open flags, each with the other booking's event name and id. A flagged request cannot be approved. */
  flags: FlagDto[];
  /** SCRUM-113/AC3: what changed on the event when it was sent back for review; null (or missing) otherwise. */
  sentBack?: SentBackNote | null;
}

/** One request in any status: GET /booking-queue/:id. */
export interface QueueDetailView extends QueueItemView {
  status: VenueBookingStatus | undefined;
  decidedByName: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  suggestion: null;
}

/** SCRUM-110/AC4: how the queue words the stored result; older requests were never checked. */
export const suitabilityLabel = (s: "suitable" | "not_suitable" | null) =>
  s === "suitable" ? "Suitable" : s === "not_suitable" ? "Not suitable" : "Not checked";

/** An instant as Singapore "YYYY-MM-DD HH:MM". */
export function formatSgt(iso: string): string {
  const { date, time } = utcToSgt(new Date(iso));
  return `${date} ${time}`;
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const clock = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** SCRUM-134/AC1: the whole time the venue is taken, setup before the event and turnaround after it, as "08:30–17:45". */
export function occupiedWindow(r: Pick<QueueItemView, "startTime" | "endTime" | "setupMinutes" | "turnaroundMinutes">): string {
  return `${clock(minutesOf(r.startTime) - r.setupMinutes)}–${clock(minutesOf(r.endTime) + r.turnaroundMinutes)}`;
}

/** "30 min setup, 45 min reset", or null when the venue needs neither. */
export function timingNote(r: Pick<QueueItemView, "setupMinutes" | "turnaroundMinutes">): string | null {
  if (r.setupMinutes === 0 && r.turnaroundMinutes === 0) return null;
  return `${r.setupMinutes} min setup, ${r.turnaroundMinutes} min reset`;
}
