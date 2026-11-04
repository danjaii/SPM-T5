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

/** What the date stepper says the view shows: "Saturday 14 November 2026", "9–15 Nov 2026" (short, so the legend fits beside it) or "November 2026". */
export function viewTitle(view: CalendarView, anchor: string): string {
  const { from, to } = viewRange(view, anchor);
  const a = parts(from);
  const b = parts(to);
  if (view === "day") return `${LONG_WEEKDAYS[weekday(from)]} ${a.day} ${LONG_MONTHS[a.month]} ${a.year}`;
  if (view === "month") return `${LONG_MONTHS[a.month]} ${a.year}`;
  if (a.year !== b.year) return `${a.day} ${MONTHS[a.month]} ${a.year} – ${b.day} ${MONTHS[b.month]} ${b.year}`;
  if (a.month !== b.month) return `${a.day} ${MONTHS[a.month]} – ${b.day} ${MONTHS[b.month]} ${b.year}`;
  return `${a.day}–${b.day} ${MONTHS[b.month]} ${b.year}`;
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

/** A venue block with the pieces the service cut it into joined again (it cuts a block where a booking starts or ends inside it). */
export interface JoinedBlock {
  /** The first piece, for its status, label and reason. */
  period: CalendarPeriod;
  start: string;
  end: string;
  /** True when any piece lies over a confirmed booking. */
  overlapsConfirmed: boolean;
}

export function joinBlocks(periods: CalendarPeriod[]): JoinedBlock[] {
  const joined: JoinedBlock[] = [];
  for (const p of periods) {
    if (p.kind !== "block") continue;
    const previous = joined[joined.length - 1];
    if (previous && previous.end === p.start) {
      previous.end = p.end;
      previous.overlapsConfirmed ||= Boolean(p.overlaps_confirmed_booking);
    } else joined.push({ period: p, start: p.start, end: p.end, overlapsConfirmed: Boolean(p.overlaps_confirmed_booking) });
  }
  return joined;
}

export interface AffectedBlock {
  venue: CalendarVenue;
  start: string;
  end: string;
  reasonLabel?: string;
}

/** SCRUM-130/AC2 (Figma 09 banner): each unavailable period that lies over a confirmed booking. */
export function affectedBlocks(venues: CalendarVenue[]): AffectedBlock[] {
  return venues.flatMap((venue) =>
    joinBlocks(venue.periods)
      .filter((b) => b.overlapsConfirmed)
      .map((b) => ({ venue, start: b.start, end: b.end, reasonLabel: b.period.reason_label })),
  );
}

/** SCRUM-130 week view (Figma 09a): the hours the occupancy bar at the top of each day covers. */
export const BAR_START_HOUR = 8;
export const BAR_END_HOUR = 22;

/** The free time of `date` as one window, from its first Available stretch to its last, or null when the venue is closed all day. */
export function freeWindow(periods: CalendarPeriod[], date: string): { start: string; end: string } | null {
  const open = blocksForDay(periods.filter((p) => p.kind === "open"), date, 0, 24);
  if (open.length === 0) return null;
  const last = open[open.length - 1];
  return { start: open[0].startTime, end: last.endTime };
}

/** The first Available stretch that starts at or after `iso` on the same Singapore day, as "17:30–22:00", or null. */
export function nextFreeWindow(periods: CalendarPeriod[], iso: string): string | null {
  const day = utcToSgt(new Date(iso)).date;
  const next = blocksForDay(periods.filter((p) => p.kind === "open" && p.start >= iso), day, 0, 24)[0];
  return next ? `${next.startTime}–${next.endTime}` : null;
}

export interface SpanningBlock extends JoinedBlock {
  /** The first and last of the days shown that the block touches (indexes into them). */
  first: number;
  last: number;
}

/** SCRUM-130/AC2 week view (Figma 09a): a block that runs over more than one of the days shown is drawn once, as a banner across them. */
export function spanningBlocks(periods: CalendarPeriod[], days: string[]): SpanningBlock[] {
  return joinBlocks(periods).flatMap((b) => {
    const touched = days.flatMap((day, i) => (busyOnDay([{ ...b.period, start: b.start, end: b.end }], day).length > 0 ? [i] : []));
    return touched.length > 1 ? [{ ...b, first: touched[0], last: touched[touched.length - 1] }] : [];
  });
}

export interface MonthRun {
  status: Extract<CalendarStatus, "BLOCKED" | "CONFIRMED" | "TENTATIVELY_HELD">;
  /** A block on these days lies over a confirmed booking. */
  conflict: boolean;
  /** The first and last of the days shown in the run (indexes into them). */
  first: number;
  last: number;
}

/** SCRUM-130 month view: consecutive days with the same busy status (and conflict), drawn as one bar. Free and closed days are not runs. */
export function monthRuns(periods: CalendarPeriod[], days: string[]): MonthRun[] {
  const runs: MonthRun[] = [];
  days.forEach((day, i) => {
    const status = dayStatus(periods, day);
    if (status === "AVAILABLE" || status === "UNAVAILABLE") return;
    const conflict = status === "BLOCKED" && busyOnDay(periods, day).some((p) => p.kind === "block" && p.overlaps_confirmed_booking);
    const previous = runs[runs.length - 1];
    if (previous && previous.last === i - 1 && previous.status === status && previous.conflict === conflict) previous.last = i;
    else runs.push({ status, conflict, first: i, last: i });
  });
  return runs;
}
