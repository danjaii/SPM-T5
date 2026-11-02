import type { QueueItemView } from "./bookingQueue";
import { waitingLabel, type LeadKpi } from "./leadQueueView";

// Browser-safe helpers for the Venue Staff dashboard (SCRUM-163). The fetchers live in ./bookingQueueServer and
// ./venueStaffDashboardServer.

const TIME_ZONE = "Asia/Singapore";

/** An approved booking: GET /booking-queue/schedule. Date and times are Singapore time. */
export interface ScheduleItemView {
  id: string;
  venueId: string;
  venueName: string;
  eventName: string;
  date: string;
  startTime: string;
  endTime: string;
  setupMinutes: number;
  turnaroundMinutes: number;
}

/** A period Venue Staff blocked, from GET /venue-calendar. */
export interface VenueBlockView {
  venueName: string;
  start: string;
  end: string;
  reasonLabel: string;
}

export const sgtDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(d);

const sgtHour = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "numeric", hour12: false }).format(d)) % 24;

/** "Good morning, Farah": the first word of the signed-in name, greeted by the Singapore hour. */
export function greeting(fullName: string, now = new Date()): string {
  const hour = sgtHour(now);
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return `Good ${part}, ${fullName.split(" ")[0]}`;
}

export const dayMonth = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, day: "numeric", month: "short" }).format(new Date(iso));

/** "Thu 14 Nov" for a Singapore date "2026-11-14". */
export const weekdayDate = (date: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`)).replace(",", "");

/** Flagged requests first, each group keeping the queue's order (oldest first): a conflict is never buried under plain ones. */
export const decisionRows = (requests: QueueItemView[]): QueueItemView[] => [
  ...requests.filter((r) => r.flags.length > 0),
  ...requests.filter((r) => r.flags.length === 0),
];

/** The blocks running now or still to come, soonest first. */
export const currentBlocks = (blocks: VenueBlockView[], now = new Date()): VenueBlockView[] =>
  blocks.filter((b) => new Date(b.end) > now).sort((a, b) => a.start.localeCompare(b.start));

/** Today's approved bookings by start time, and how many start in the week the schedule covers. */
export const todaysBookings = (schedule: ScheduleItemView[], now = new Date()) => schedule.filter((s) => s.date === sgtDate(now));

/**
 * The figures above the list. A figure whose source failed (undefined) is left out rather than shown as zero.
 * Waiting links to the queue (AC1); Conflicts counts the requests carrying a flag (AC2).
 */
export function venueStaffKpis(requests: QueueItemView[] | undefined, schedule: ScheduleItemView[] | undefined, blocks: VenueBlockView[] | undefined, now = new Date()): LeadKpi[] {
  const kpis: LeadKpi[] = [];
  if (requests) {
    const flagged = requests.filter((r) => r.flags.length > 0);
    kpis.push({
      label: "Waiting",
      value: requests.length,
      note: requests.length > 0 ? `Oldest waiting ${waitingLabel(requests[0].submittedAt, now)}` : "Nothing is waiting",
      href: "/booking-queue",
    });
    kpis.push({
      label: "Conflicts",
      value: flagged.length,
      note: flagged.length > 0 ? `${flagged[0].venueName} on ${dayMonth(`${flagged[0].date}T00:00:00+08:00`)}` : "No conflicts",
      warn: flagged.length > 0,
    });
  }
  if (schedule) {
    const next = blocks && currentBlocks(blocks, now)[0];
    kpis.push({
      label: "Bookings this week",
      value: schedule.length,
      note: next ? `${next.venueName} unavailable until ${dayMonth(next.end)}` : "Approved bookings",
    });
  }
  return kpis;
}

/** "4 requests are waiting. 1 has a conflict you should resolve first." */
export function summaryLine(requests: QueueItemView[] | undefined): string {
  if (!requests) return "Some figures could not be loaded.";
  if (requests.length === 0) return "No booking requests are waiting.";
  const flagged = requests.filter((r) => r.flags.length > 0).length;
  const waiting = `${requests.length} ${requests.length === 1 ? "request is" : "requests are"} waiting.`;
  return flagged > 0 ? `${waiting} ${flagged} ${flagged === 1 ? "has a conflict" : "have conflicts"} you should resolve first.` : waiting;
}
