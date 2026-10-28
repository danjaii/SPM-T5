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

export type CalendarRangeResult = { ok: true; data: CalendarRange } | { ok: false; fieldErrors: Record<string, string> };

/** The longest range one request may ask for, in days (both ends counted): a month view with room to spare. */
export const MAX_CALENDAR_DAYS = 62;

const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** True when YYYY-MM-DD is a day that exists (2026-02-30 does not). */
function isRealDate(date: string): boolean {
  if (!DATE_PATTERN.test(date)) return false;
  return new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) === date;
}

/**
 * SCRUM-84/AC5 + AC6: the range a request asks for. `from` and `to` are Singapore dates, both inclusive; no dates is the current
 * week and `from` alone is that one day. An end before the start, a malformed date and a range over MAX_CALENDAR_DAYS are refused
 * with a message per field, so the page can keep the previous view and say why.
 */
export function parseCalendarRange(query: { from?: unknown; to?: unknown }, now: Date): CalendarRangeResult {
  const from = String(query.from ?? "");
  const to = String(query.to ?? "");
  if (!from && !to) return { ok: true, data: currentWeek(now) };

  const errors: Record<string, string> = {};
  if (!from) errors.from = "Choose a start date.";
  else if (!isRealDate(from)) errors.from = "Enter the date as YYYY-MM-DD.";
  if (to && !isRealDate(to)) errors.to = "Enter the date as YYYY-MM-DD.";
  if (Object.keys(errors).length) return { ok: false, fieldErrors: errors };

  const last = to || from;
  if (last < from) return { ok: false, fieldErrors: { to: "The end date must be on or after the start date." } };
  const range = calendarRange(from, last);
  if ((range.end.getTime() - range.start.getTime()) / 86_400_000 > MAX_CALENDAR_DAYS) {
    return { ok: false, fieldErrors: { to: `Choose a range of ${MAX_CALENDAR_DAYS} days or fewer.` } };
  }
  return { ok: true, data: range };
}
