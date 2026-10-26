import { sgtToUtc, utcToSgt } from "./venueBooking";

/**
 * SCRUM-84 (docs/specs/SCRUM-84-venue-availability-calendar.md): the date range of the venue availability calendar.
 * Dates are Singapore dates (YYYY-MM-DD), both ends inclusive; instants are UTC.
 */
export const CALENDAR_TIME_ZONE = "Asia/Singapore";

export interface CalendarRange {
  /** First and last Singapore day, inclusive. */
  from: string;
  to: string;
  /** The same range as instants: the start of `from` and the start of the day after `to` (exclusive). */
  start: Date;
  end: Date;
}

/** `date` moved by `days` calendar days (YYYY-MM-DD in, YYYY-MM-DD out). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The range from one Singapore day to another, inclusive. */
export function calendarRange(from: string, to: string): CalendarRange {
  return { from, to, start: sgtToUtc(from, "00:00"), end: sgtToUtc(addDays(to, 1), "00:00") };
}

/** SCRUM-84/AC1: the week (Monday to Sunday, Singapore time) that contains `now`. */
export function currentWeek(now: Date): CalendarRange {
  const today = utcToSgt(now).date;
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
  const monday = addDays(today, -((weekday + 6) % 7));
  return calendarRange(monday, addDays(monday, 6));
}
