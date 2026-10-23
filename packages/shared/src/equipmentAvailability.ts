import { sgtToUtc } from "./venueBooking";

// SCRUM-18 (docs/specs/equipment-availability.md): the input checks for the equipment availability check.
// They live here, in packages/shared, so the web form and equipment-service use the very same code and can
// never say different things.

/** AC7: a date like 2026-10-15 (four-digit year, month 01-12, day 01-31). */
const DATE_FORMAT = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** AC7: a 24-hour time like 09:00 or 17:30. */
const TIME_FORMAT = /^([01]\d|2[0-3]):[0-5]\d$/;

/** AC7: true when YYYY-MM-DD is a day that exists (2026-02-30 does not). */
function isRealDate(date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  // JavaScript quietly rolls 30 February over to 2 March, so check the day did not move.
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/**
 * The quantity rule, shared by SCRUM-18 (checking availability) and SCRUM-19 (reserving): a whole number of at least
 * 1. Returns the message to show, or undefined when the quantity is fine. Spaces around it are ignored, and a
 * quantity left out entirely counts as empty.
 */
export function quantityError(value: unknown): string | undefined {
  const quantity = String(value ?? "").trim();
  if (quantity === "") return "Please enter the quantity required.";
  // Digits only (so no "-", "." or letters), and not 0.
  if (!/^\d+$/.test(quantity) || Number(quantity) < 1) return "Please enter a whole number of at least 1.";
  return undefined;
}

/** A checked, cleaned-up question, ready to work with. */
export interface AvailabilityInput {
  equipmentName: string;
  quantity: number;
  date: string;
  startTime: string;
  endTime: string;
  /** The period as the times the database uses (UTC); the form's date and times are Singapore time. */
  start: Date;
  end: Date;
}

/** Either the cleaned-up question, or a message for every field that needs fixing. */
export type ParsedAvailabilityInput =
  | { ok: true; data: AvailabilityInput }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * SCRUM-18: checks the five fields of an availability question. `now` is passed in so tests (and the server's
 * clock) decide what "in the past" means. Anything that is not an object is treated as an empty question.
 */
export function parseAvailabilityInput(body: unknown, now: Date): ParsedAvailabilityInput {
  const query = (body !== null && typeof body === "object" ? body : {}) as Record<string, unknown>;

  // Each field as text with the spaces around it removed; a field left out entirely counts as blank.
  const text = (value: unknown) => String(value ?? "").trim();

  // AC4: spaces around the name are removed; a name with nothing left is missing, so prompt for it.
  const equipmentName = text(query.equipmentName);
  //  .trim() removes whitespaces on both ends
  // ?? "" means if they do something like entering the url of the second webpage, bypasing the first, that means we treat name as ""

  const quantity = text(query.quantity);
  const date = text(query.date);
  const startTime = text(query.startTime);
  const endTime = text(query.endTime);

  const period = { date, startTime, endTime };

  // AC4 + AC6: collect a prompt for every missing field, then refuse once, so the user sees them all together.
  const missing: Record<string, string> = { ...periodMissing(period) };
  if (equipmentName === "") missing.equipmentName = "Please enter the equipment name.";
  if (quantity === "") missing.quantity = quantityError(quantity)!;
  if (Object.keys(missing).length > 0) return { ok: false, fieldErrors: missing };

  // AC7: everything is filled in, but is it valid? First the format of each field...
  const invalid: Record<string, string> = { ...periodFormatErrors(period) };
  // 18-S12: digits only (so no "-", "." or letters), and not 0.
  const quantityProblem = quantityError(quantity);
  if (quantityProblem) invalid.quantity = quantityProblem;
  if (Object.keys(invalid).length > 0) return { ok: false, fieldErrors: invalid };

  // ...then whether the period itself makes sense.
  const timing = periodTimingError(period, now);
  if (!timing.ok) return { ok: false, fieldErrors: timing.fieldErrors };

  return {
    ok: true,
    data: { equipmentName, quantity: Number(quantity), date, startTime, endTime, start: timing.start, end: timing.end },
  };
}

// ---------------------------------------------------------------------------
// The date and time period rules, shared by SCRUM-18 (checking availability) and SCRUM-19 (reserving), in the
// three stages both use: missing, wrong format, then whether the period makes sense.
// ---------------------------------------------------------------------------

/** A period as typed: a date (YYYY-MM-DD) and a start and end time (HH:MM), Singapore time, already trimmed. */
export interface PeriodFields {
  date: string;
  startTime: string;
  endTime: string;
}

/** Stage 1: a prompt for each of the date, start time and end time that is empty. */
export function periodMissing({ date, startTime, endTime }: PeriodFields): Record<string, string> {
  const missing: Record<string, string> = {};
  if (date === "") missing.date = "Please enter a date.";
  if (startTime === "") missing.startTime = "Please enter a start time.";
  if (endTime === "") missing.endTime = "Please enter an end time.";
  return missing;
}

/** Stage 2: a message for each field that is filled in but in the wrong format, or a date that does not exist. */
export function periodFormatErrors({ date, startTime, endTime }: PeriodFields): Record<string, string> {
  const invalid: Record<string, string> = {};
  if (!DATE_FORMAT.test(date)) invalid.date = "Please enter the date as YYYY-MM-DD.";
  else if (!isRealDate(date)) invalid.date = "Please enter a real date.";
  if (!TIME_FORMAT.test(startTime)) invalid.startTime = "Please enter the start time as HH:MM.";
  if (!TIME_FORMAT.test(endTime)) invalid.endTime = "Please enter the end time as HH:MM.";
  return invalid;
}

/** SCRUM-137: the period the inventory is shown for, as typed and as UTC instants. */
export interface InventoryPeriod {
  date: string;
  startTime: string;
  endTime: string;
  start: Date;
  end: Date;
}

/**
 * SCRUM-137/AC2: checks the inventory's period with the same stages and messages as SCRUM-18's check, except that a
 * period already under way is allowed: the inventory only shows what is free, it books nothing.
 */
export function parseInventoryPeriod(
  body: unknown,
): { ok: true; data: InventoryPeriod } | { ok: false; fieldErrors: Record<string, string> } {
  const query = (body !== null && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const text = (value: unknown) => String(value ?? "").trim();
  const period = { date: text(query.date), startTime: text(query.startTime), endTime: text(query.endTime) };

  const missing = periodMissing(period);
  if (Object.keys(missing).length > 0) return { ok: false, fieldErrors: missing };
  const invalid = periodFormatErrors(period);
  if (Object.keys(invalid).length > 0) return { ok: false, fieldErrors: invalid };
  // Any moment counts as "now" here: only the end-after-start rule applies.
  const timing = periodTimingError(period, new Date(-8.64e15));
  if (!timing.ok) return { ok: false, fieldErrors: timing.fieldErrors };
  return { ok: true, data: { ...period, start: timing.start, end: timing.end } };
}

/**
 * Stage 3 (only for a period that passed stages 1 and 2): the end must be after the start, and the start must not
 * be before `now`. On success, the period as the UTC instants the database uses.
 */
export function periodTimingError(
  { date, startTime, endTime }: PeriodFields,
  now: Date,
): { ok: true; start: Date; end: Date } | { ok: false; fieldErrors: Record<string, string> } {
  // The form's date and times are Singapore time; the database stores UTC.
  const start = sgtToUtc(date, startTime);
  const end = sgtToUtc(date, endTime);
  if (end.getTime() <= start.getTime()) {
    return { ok: false, fieldErrors: { endTime: "The end time must be after the start time." } };
  }
  if (start.getTime() < now.getTime()) {
    return { ok: false, fieldErrors: { startTime: "The date and time must not be in the past." } };
  }
  return { ok: true, start, end };
}
