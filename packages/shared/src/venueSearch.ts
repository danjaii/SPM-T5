import { sgtToUtc, utcToSgt } from "./venueBooking";

// SCRUM-65 (docs/specs/venue-search.md): the input checks for the venue search. They live here, in
// packages/shared, so the search form and venue-service use the very same code and can never disagree.

const DATE_FORMAT = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_FORMAT = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True when YYYY-MM-DD is a day that exists (2026-02-30 does not). */
function isRealDate(date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** A checked, cleaned-up search, ready to work with. Optional filters are absent (or empty/false) when not set. */
export interface VenueSearchPeriod {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  /** The period as the instants the database uses (UTC); the form's date and times are Singapore time. */
  start: Date;
  end: Date;
}

export interface VenueSearchInput {
  /** Absent when the search gives no date or time at all: availability is then not checked. */
  period?: VenueSearchPeriod;
  attendance?: number;
  location?: string;
  layoutId?: string;
  /** True only when the accessibility filter is switched on; false means "do not filter". */
  accessible: boolean;
  facilityIds: string[];
}

export type ParsedVenueSearchInput =
  | { ok: true; data: VenueSearchInput }
  | { ok: false; fieldErrors: Record<string, string> };

const text = (value: unknown) => String(value ?? "").trim();

/** Accepts true / "true" / "on" / "1" (a checkbox or a query string). */
function isOn(value: unknown): boolean {
  return value === true || ["true", "on", "1"].includes(text(value).toLowerCase());
}

/** A list given as an array, or as one comma-separated string (a query string); blanks and repeats dropped. */
function toList(value: unknown): string[] {
  const parts = Array.isArray(value) ? value.map(text) : text(value).split(",").map((s) => s.trim());
  return [...new Set(parts.filter((s) => s !== ""))];
}

/**
 * SCRUM-65: checks a venue search. `now` is passed in so tests (and the server's clock) decide what "today" is.
 * Anything that is not an object is treated as an empty search.
 */
export function parseVenueSearchInput(body: unknown, now: Date): ParsedVenueSearchInput {
  const query = (body !== null && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const startDate = text(query.startDate);
  const startTime = text(query.startTime);
  const endDate = text(query.endDate);
  const endTime = text(query.endTime);

  // No date or time at all is a search without a period. A half-filled period still prompts (AC4).
  const hasPeriod = [startDate, startTime, endDate, endTime].some((v) => v !== "");

  // AC4: prompt for every missing field at once.
  const missing: Record<string, string> = {};
  if (hasPeriod) {
    if (startDate === "") missing.startDate = "Please enter a start date.";
    if (startTime === "") missing.startTime = "Please enter a start time.";
    if (endDate === "") missing.endDate = "Please enter an end date.";
    if (endTime === "") missing.endTime = "Please enter an end time.";
  }
  if (Object.keys(missing).length > 0) return { ok: false, fieldErrors: missing };

  const invalid: Record<string, string> = {};
  if (hasPeriod) {
    if (!DATE_FORMAT.test(startDate)) invalid.startDate = "Please enter the start date as YYYY-MM-DD.";
    else if (!isRealDate(startDate)) invalid.startDate = "Please enter a real start date.";
    // AC5: a day before today (Singapore time) cannot be searched. Today itself is fine.
    else if (startDate < utcToSgt(now).date) invalid.startDate = "The start date must not be in the past.";
    if (!DATE_FORMAT.test(endDate)) invalid.endDate = "Please enter the end date as YYYY-MM-DD.";
    else if (!isRealDate(endDate)) invalid.endDate = "Please enter a real end date.";
    if (!TIME_FORMAT.test(startTime)) invalid.startTime = "Please enter the start time as HH:MM.";
    if (!TIME_FORMAT.test(endTime)) invalid.endTime = "Please enter the end time as HH:MM.";

    // AC6: the end must be after the start. An earlier end date is reported on the end date; the same day with
    // an end time that is not later is reported on the end time. (Dates and times are valid by this point, so
    // comparing YYYY-MM-DD and HH:MM text is enough.)
    if (!invalid.startDate && !invalid.endDate) {
      if (endDate < startDate) invalid.endDate = "The end date must not be before the start date.";
      else if (endDate === startDate && !invalid.startTime && !invalid.endTime && endTime <= startTime) {
        invalid.endTime = "The end time must be after the start time.";
      }
    }
  }

  // AC3 / AC2: optional filters. Attendance is a whole number of at least 1 when given.
  const attendanceText = text(query.attendance);
  if (attendanceText !== "" && (!/^\d+$/.test(attendanceText) || Number(attendanceText) < 1)) {
    invalid.attendance = "Please enter a whole number of at least 1.";
  }
  if (Object.keys(invalid).length > 0) return { ok: false, fieldErrors: invalid };

  const location = text(query.location);
  const layoutId = text(query.layoutId);
  return {
    ok: true,
    data: {
      ...(hasPeriod
        ? { period: { startDate, startTime, endDate, endTime, start: sgtToUtc(startDate, startTime), end: sgtToUtc(endDate, endTime) } }
        : {}),
      ...(attendanceText !== "" ? { attendance: Number(attendanceText) } : {}),
      ...(location !== "" ? { location } : {}),
      ...(layoutId !== "" ? { layoutId } : {}),
      accessible: isOn(query.accessible),
      facilityIds: toList(query.facilityIds),
    },
  };
}
