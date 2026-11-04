import { addDays, sgtToUtc, utcToSgt } from "@spm-t5/shared";
import type { CalendarPeriod } from "./venueCalendar";

// SCRUM-130/AC1: where the calendar's periods sit on a week grid (days across, hours down). Everything is Singapore time.

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** The hours a column covers unless a booking, setup or block falls outside them. */
const DEFAULT_START_HOUR = 6;
const DEFAULT_END_HOUR = 22;

/** The days of a range (Singapore dates, inclusive), a week of seven at a time; the last week may be shorter. */
export function weekChunks(from: string, to: string): string[][] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

/**
 * The hours every column covers: 06:00 to 22:00, widened to whole hours so that no booking, setup, turnaround or block is cut off.
 * Available and Unavailable stretches do not widen it (they fill the day and would always stretch it to 24 hours).
 */
export function hourBounds(periods: CalendarPeriod[]): { startHour: number; endHour: number } {
  let startHour = DEFAULT_START_HOUR;
  let endHour = DEFAULT_END_HOUR;
  for (const p of periods) {
    if (p.kind === "open" || p.kind === "closed") continue;
    const start = new Date(p.start);
    const end = new Date(p.end);
    const s = utcToSgt(start);
    const e = utcToSgt(end);
    // hours into the Singapore day; a period that runs over midnight is cut at each day's edge, so it reaches 0 or 24
    const startsHour = Number(s.time.slice(0, 2));
    const endMinutes = Number(e.time.slice(0, 2)) * 60 + Number(e.time.slice(3, 5));
    const endsHour = endMinutes === 0 && e.date !== s.date ? 24 : Math.ceil(endMinutes / 60);
    startHour = Math.min(startHour, startsHour);
    endHour = Math.max(endHour, e.date !== s.date && endMinutes > 0 ? 24 : endsHour);
  }
  return { startHour: Math.max(0, startHour), endHour: Math.min(24, endHour) };
}

export interface DayBlock {
  period: CalendarPeriod;
  /** Singapore times of the part of the period that falls in this column. */
  startTime: string;
  endTime: string;
  /** Position and size as a share of the column (0 to 100). */
  topPct: number;
  heightPct: number;
}

/** The parts of `periods` that fall on `date` between `startHour` and `endHour`, in the order given. */
export function blocksForDay(periods: CalendarPeriod[], date: string, startHour: number, endHour: number): DayBlock[] {
  const dayStart = sgtToUtc(date, "00:00").getTime();
  const windowStart = dayStart + startHour * HOUR_MS;
  const windowEnd = Math.min(dayStart + endHour * HOUR_MS, dayStart + DAY_MS);
  const span = windowEnd - windowStart;
  const blocks: DayBlock[] = [];
  for (const period of periods) {
    const start = Math.max(new Date(period.start).getTime(), windowStart);
    const end = Math.min(new Date(period.end).getTime(), windowEnd);
    if (end <= start) continue;
    blocks.push({
      period,
      startTime: utcToSgt(new Date(start)).time,
      endTime: end === dayStart + DAY_MS ? "24:00" : utcToSgt(new Date(end)).time,
      topPct: ((start - windowStart) / span) * 100,
      heightPct: ((end - start) / span) * 100,
    });
  }
  return blocks;
}
