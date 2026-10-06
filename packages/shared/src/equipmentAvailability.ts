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

  // AC4 + AC6: collect a prompt for every missing field, then refuse once, so the user sees them all together.
  const missing: Record<string, string> = {};
  if (equipmentName === "") missing.equipmentName = "Please enter the equipment name.";
  if (quantity === "") missing.quantity = "Please enter the quantity required.";
  if (date === "") missing.date = "Please enter a date.";
  if (startTime === "") missing.startTime = "Please enter a start time.";
  if (endTime === "") missing.endTime = "Please enter an end time.";
  if (Object.keys(missing).length > 0) return { ok: false, fieldErrors: missing };

  // AC7: everything is filled in, but is it valid? First the format of each field...
  const invalid: Record<string, string> = {};
  // 18-S12: digits only (so no "-", "." or letters), and not 0.
  if (!/^\d+$/.test(quantity) || Number(quantity) < 1) invalid.quantity = "Please enter a whole number of at least 1.";
  if (!DATE_FORMAT.test(date)) invalid.date = "Please enter the date as YYYY-MM-DD.";
  else if (!isRealDate(date)) invalid.date = "Please enter a real date.";
  if (!TIME_FORMAT.test(startTime)) invalid.startTime = "Please enter the start time as HH:MM.";
  if (!TIME_FORMAT.test(endTime)) invalid.endTime = "Please enter the end time as HH:MM.";
  if (Object.keys(invalid).length > 0) return { ok: false, fieldErrors: invalid };

  // The form's date and times are Singapore time; the database stores UTC.
  const start = sgtToUtc(date, startTime);
  const end = sgtToUtc(date, endTime);

  // ...then whether the period itself makes sense.
  if (end.getTime() <= start.getTime()) {
    return { ok: false, fieldErrors: { endTime: "The end time must be after the start time." } };
  }
  if (start.getTime() < now.getTime()) {
    return { ok: false, fieldErrors: { startTime: "The date and time must not be in the past." } };
  }

  return { ok: true, data: { equipmentName, quantity: Number(quantity), date, startTime, endTime, start, end } };
}
