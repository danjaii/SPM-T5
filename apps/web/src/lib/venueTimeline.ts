import { addDays, sgtToUtc, utcToSgt } from "@spm-t5/shared";
import type { CalendarPeriod, CalendarStatus, CalendarVenue } from "./venueCalendar";

// SCRUM-130 (Figma 09): where the calendar's periods sit on the venue timeline (venues down, time across). Everything is Singapore time.

export type CalendarView = "day" | "week" | "month";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** The hours the day view covers unless a booking, setup or block falls outside them (Figma 09: 08:00 to 20:00). */
const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 20;

/** Today in Singapore (YYYY-MM-DD). */
export function todaySgt(now: Date = new Date()): string {
  return utcToSgt(now).date;
}

const weekday = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday

/** The Singapore days a view shows around `anchor`: the day, its Monday-to-Sunday week, or its calendar month. */
export function viewRange(view: CalendarView, anchor: string): { from: string; to: string } {
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "week") {
    const monday = addDays(anchor, -((weekday(anchor) + 6) % 7));
    return { from: monday, to: addDays(monday, 6) };
  }
  const first = `${anchor.slice(0, 7)}-01`;
  const nextMonth = new Date(Date.UTC(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)), 1)).toISOString().slice(0, 10);
  return { from: first, to: addDays(nextMonth, -1) };
}

/** The anchor one view earlier (-1) or later (1): a day, a week, or the same day of the month before or after (capped at its end). */
export function stepAnchor(view: CalendarView, anchor: string, direction: 1 | -1): string {
  if (view === "day") return addDays(anchor, direction);
  if (view === "week") return addDays(anchor, 7 * direction);
  const month = new Date(Date.UTC(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)) - 1 + direction, 1)).toISOString().slice(0, 10);
  const { to } = viewRange("month", month);
  return `${month.slice(0, 8)}${String(Math.min(Number(anchor.slice(8)), Number(to.slice(8)))).padStart(2, "0")}`;
}

/** Every Singapore day from `from` to `to`, both included. */
export function daysOf(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const parts = (date: string) => ({ day: Number(date.slice(8)), month: Number(date.slice(5, 7)) - 1, year: date.slice(0, 4) });

/** "Sat 14 Nov": a day as a column heading or on the date stepper. */
export function shortDay(date: string): string {
  const { day, month } = parts(date);
  return `${WEEKDAYS[weekday(date)]} ${day} ${MONTHS[month]}`;
}

/** What the page subtitle says the view shows: "Saturday 14 November 2026", "9 to 15 November 2026" or "November 2026". */
export function viewTitle(view: CalendarView, anchor: string): string {
  const { from, to } = viewRange(view, anchor);
  const a = parts(from);
  const b = parts(to);
  if (view === "day") return `${LONG_WEEKDAYS[weekday(from)]} ${a.day} ${LONG_MONTHS[a.month]} ${a.year}`;
  if (view === "month") return `${LONG_MONTHS[a.month]} ${a.year}`;
  if (a.year !== b.year) return `${a.day} ${LONG_MONTHS[a.month]} ${a.year} to ${b.day} ${LONG_MONTHS[b.month]} ${b.year}`;
  if (a.month !== b.month) return `${a.day} ${LONG_MONTHS[a.month]} to ${b.day} ${LONG_MONTHS[b.month]} ${b.year}`;
  return `${a.day} to ${b.day} ${LONG_MONTHS[b.month]} ${b.year}`;
}

/** "08:00": a whole hour as a column heading. */
export const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/**
 * The hours the day view covers: 08:00 to 20:00, widened to whole hours so that no booking, setup or turnaround on `date` is cut
 * off. Blocks, Available and Unavailable stretches do not widen it: they often fill the day and would stretch it to 24 hours.
 */
export function hourBounds(venues: CalendarVenue[], date: string): { startHour: number; endHour: number } {
  const dayStart = sgtToUtc(date, "00:00").getTime();
  let startHour = DEFAULT_START_HOUR;
  let endHour = DEFAULT_END_HOUR;
  for (const p of venues.flatMap((v) => v.periods)) {
    if (p.kind !== "event" && p.kind !== "setup" && p.kind !== "turnaround") continue;
    const start = Math.max(new Date(p.start).getTime(), dayStart);
    const end = Math.min(new Date(p.end).getTime(), dayStart + DAY_MS);
    if (end <= start) continue;
    startHour = Math.min(startHour, Math.floor((start - dayStart) / HOUR_MS));
    endHour = Math.max(endHour, Math.ceil((end - dayStart) / HOUR_MS));
  }
  return { startHour, endHour };
}

export interface TimelineBlock {
  period: CalendarPeriod;
  /** Singapore times of the part of the period that falls in the window. */
  startTime: string;
  endTime: string;
  /** Position and size as a share of the row (0 to 100). */
  leftPct: number;
  widthPct: number;
}

/** The parts of `periods` that fall on `date` between `startHour` and `endHour`, in the order given. */
export function blocksForDay(periods: CalendarPeriod[], date: string, startHour: number, endHour: number): TimelineBlock[] {
  const dayStart = sgtToUtc(date, "00:00").getTime();
  const windowStart = dayStart + startHour * HOUR_MS;
  const windowEnd = dayStart + endHour * HOUR_MS;
  const span = windowEnd - windowStart;
  const blocks: TimelineBlock[] = [];
  for (const period of periods) {
    const start = Math.max(new Date(period.start).getTime(), windowStart);
    const end = Math.min(new Date(period.end).getTime(), windowEnd);
    if (end <= start) continue;
    blocks.push({
      period,
      startTime: utcToSgt(new Date(start)).time,
      endTime: end === dayStart + DAY_MS ? "24:00" : utcToSgt(new Date(end)).time,
      leftPct: ((start - windowStart) / span) * 100,
      widthPct: ((end - start) / span) * 100,
    });
  }
  return blocks;
}

/** Where `now` sits on the day view, as a share of the row, or null when it is another day or outside the hours shown. */
export function nowPct(date: string, startHour: number, endHour: number, now: Date = new Date()): number | null {
  const dayStart = sgtToUtc(date, "00:00").getTime();
  const pct = ((now.getTime() - dayStart - startHour * HOUR_MS) / ((endHour - startHour) * HOUR_MS)) * 100;
  return pct >= 0 && pct <= 100 ? pct : null;
}

/** The periods that touch `date`, booked or blocked ones only (free and closed time is the background). */
export function busyOnDay(periods: CalendarPeriod[], date: string): CalendarPeriod[] {
  const dayStart = sgtToUtc(date, "00:00").getTime();
  return periods.filter(
    (p) => (p.kind === "event" || p.kind === "block") && new Date(p.start).getTime() < dayStart + DAY_MS && new Date(p.end).getTime() > dayStart,
  );
}

const BUSIEST: CalendarStatus[] = ["BLOCKED", "CONFIRMED", "TENTATIVELY_HELD"];

/** SCRUM-130 month view: the one status a day cell shows, the busiest first: Blocked, Confirmed, Tentatively Held, then free or closed. */
export function dayStatus(periods: CalendarPeriod[], date: string): CalendarStatus {
  const busy = busyOnDay(periods, date);
  const found = BUSIEST.find((status) => busy.some((p) => p.status === status));
  if (found) return found;
  const dayStart = sgtToUtc(date, "00:00").getTime();
  const open = periods.some((p) => p.kind === "open" && new Date(p.start).getTime() < dayStart + DAY_MS && new Date(p.end).getTime() > dayStart);
  return open ? "AVAILABLE" : "UNAVAILABLE";
}

export interface AffectedBlock {
  venue: CalendarVenue;
  start: string;
  end: string;
  reasonLabel?: string;
}

/**
 * SCRUM-130/AC2 (Figma 09 banner): each unavailable period that lies over a confirmed booking. The service cuts a block where a
 * booking starts or ends inside it, so pieces of one block that touch are joined again here.
 */
export function affectedBlocks(venues: CalendarVenue[]): AffectedBlock[] {
  const found: AffectedBlock[] = [];
  for (const venue of venues) {
    let current: (AffectedBlock & { flagged: boolean }) | null = null;
    for (const p of venue.periods) {
      if (p.kind === "block" && current && current.end === p.start) {
        current.end = p.end;
        current.flagged ||= Boolean(p.overlaps_confirmed_booking);
        continue;
      }
      if (current?.flagged) found.push({ venue, start: current.start, end: current.end, reasonLabel: current.reasonLabel });
      current = p.kind === "block" ? { venue, start: p.start, end: p.end, reasonLabel: p.reason_label, flagged: Boolean(p.overlaps_confirmed_booking) } : null;
    }
    if (current?.flagged) found.push({ venue, start: current.start, end: current.end, reasonLabel: current.reasonLabel });
  }
  return found;
}
