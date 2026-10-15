import { z } from "zod";

// Venue booking rules shared by venue-service and apps/web (docs/specs/venue-booking-request.md).
// Statuses below must match the venue_booking_status enum in supabase/migrations (05 adds 'withdrawn').

// ---------------------------------------------------------------------------
// DR4: statuses. The API speaks PENDING/APPROVED/REJECTED/WITHDRAWN; the DB enum is wider.
// ---------------------------------------------------------------------------

export const VENUE_BOOKING_STATUSES = ["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"] as const;
export type VenueBookingStatus = (typeof VENUE_BOOKING_STATUSES)[number];

const DB_TO_API: Record<string, VenueBookingStatus> = {
  requested: "PENDING",
  approved: "APPROVED",
  tentative: "APPROVED", // legacy seed rows
  confirmed: "APPROVED", // legacy seed rows
  rejected: "REJECTED",
  withdrawn: "WITHDRAWN",
};

/** Maps a DB status to the API status. `cancelled` (legacy) is outside this feature, so undefined. */
export function dbStatusToApi(dbStatus: string): VenueBookingStatus | undefined {
  return DB_TO_API[dbStatus];
}

/** DR5: a request holds its venue and period only in these DB statuses. */
export const HOLDING_DB_STATUSES = ["requested", "tentative", "approved", "confirmed"] as const;

export function isHoldingDbStatus(dbStatus: string): boolean {
  return (HOLDING_DB_STATUSES as readonly string[]).includes(dbStatus);
}

// ---------------------------------------------------------------------------
// DR12: error codes for business-rule refusals (HTTP 409).
// ---------------------------------------------------------------------------

export const VENUE_BOOKING_ERROR_CODES = [
  "SLOT_CONFLICT",
  "NOT_PENDING",
  "NOT_REJECTED",
  "REPEAT_OF_REJECTED",
  "ACTIVE_REQUEST_EXISTS",
  "EVENT_NOT_ELIGIBLE",
  "SUGGESTION_ALREADY_USED",
  "NO_SUGGESTION",
  "SLOT_IN_PAST",
  "DUPLICATE_VENUE",
  "VERSION_CONFLICT",
  "NO_CHANGES",
  "NOT_ACTIVE",
] as const;
export type VenueBookingErrorCode = (typeof VENUE_BOOKING_ERROR_CODES)[number];

export const VENUE_BOOKING_MESSAGES = {
  SLOT_CONFLICT: "This venue is already held for part of that period.",
  EVENT_NOT_ELIGIBLE: "The event must be approved before a venue can be requested.",
  // SCRUM-98 (98-S20): only for replacing a rejected request; an event itself may hold several venue bookings
  ACTIVE_REQUEST_EXISTS: "This rejected request already has an active replacement.",
  REPEAT_OF_REJECTED: "That slot was already rejected. Choose a different venue, date or time.",
  NOT_PENDING: "This request is no longer pending.",
  NOT_REJECTED: "Only a rejected request can be amended.",
  SUGGESTION_ALREADY_USED: "The suggested alternative has already been used.",
  NO_SUGGESTION: "This request has no suggested alternative.",
  SLOT_IN_PAST: "The requested time has already passed.",
  // SCRUM-98/AC3: the event's own booking holds this venue; another event's is SLOT_CONFLICT
  DUPLICATE_VENUE: "This event already holds this venue for part of that period.",
  // SCRUM-102/AC1 (102-S9): a change identical to what the venue booking already has would only send it back to venue staff
  NO_CHANGES: "Nothing was changed.",
  // SCRUM-102 (102-S11): a rejected one is amended instead (SCRUM-60); a withdrawn or cancelled one is finished
  NOT_ACTIVE: "Only a pending or approved venue booking can be changed or cancelled.",
} as const;

// ---------------------------------------------------------------------------
// DR9: which event statuses may raise a venue request. Must match event_status in 01_schema.sql.
// `awaiting_arrangements` added by team decision on 2026-09-29; `returned` is not eligible.
// ---------------------------------------------------------------------------

export const VENUE_REQUEST_ELIGIBLE_EVENT_STATUSES = ["approved", "planning", "awaiting_arrangements"] as const;

export function canRequestVenue(eventStatus: string): boolean {
  return (VENUE_REQUEST_ELIGIBLE_EVENT_STATUSES as readonly string[]).includes(eventStatus);
}

// ---------------------------------------------------------------------------
// DR3: Singapore time (fixed UTC+8, no DST) in and out, UTC in storage.
// ---------------------------------------------------------------------------

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** "2026-11-14" + "09:00" (Singapore) -> the UTC instant. */
export function sgtToUtc(date: string, time: string): Date {
  return new Date(Date.parse(`${date}T${time}:00.000Z`) - SGT_OFFSET_MS);
}

/** A UTC instant -> Singapore { date: "YYYY-MM-DD", time: "HH:MM" }. */
export function utcToSgt(instant: Date): { date: string; time: string } {
  const iso = new Date(instant.getTime() + SGT_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

// ---------------------------------------------------------------------------
// DR5: two periods overlap when each starts before the other ends (half-open).
// ---------------------------------------------------------------------------

export interface Period {
  start: Date;
  end: Date;
}

export function periodsOverlap(a: Period, b: Period): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

// ---------------------------------------------------------------------------
// 32-S5: input validation, identical in the form (apps/web) and the API (venue-service).
// ---------------------------------------------------------------------------

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const inputShape = z.object({
  venueId: z.string({ required_error: "Choose a venue." }).min(1, "Choose a venue."),
  date: z.string({ required_error: "Enter a date." }).regex(DATE, "Enter the date as YYYY-MM-DD."),
  startTime: z.string({ required_error: "Enter a start time." }).regex(TIME, "Enter the start time as HH:MM."),
  endTime: z.string({ required_error: "Enter an end time." }).regex(TIME, "Enter the end time as HH:MM."),
});

export interface VenueBookingInput {
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
  /** Requested period as UTC instants (a booking is one calendar day, so end is on the same SGT date). */
  start: Date;
  end: Date;
  /** SCRUM-98/AC2: this booking's own numbers. Undefined means "use the event's". */
  expectedAttendance?: number;
  venueRequirements?: string;
}

export const VENUE_REQUIREMENTS_MAX_LENGTH = 500;

/**
 * SCRUM-98/AC2 (98-S6, 98-S7, 98-S12): the booking's own expected attendance and venue requirements, both
 * optional. Left out, null or blank means "use the event's", so they come back undefined.
 */
function ownDetails(body: unknown) {
  const raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const fieldErrors: Record<string, string> = {};
  let expectedAttendance: number | undefined;
  let venueRequirements: string | undefined;

  const attendance = raw.expectedAttendance;
  if (attendance !== undefined && attendance !== null) {
    if (typeof attendance === "number" && Number.isInteger(attendance) && attendance >= 1) expectedAttendance = attendance;
    else fieldErrors.expectedAttendance = "Enter the expected attendance as a whole number of 1 or more.";
  }

  const requirements = raw.venueRequirements;
  if (requirements !== undefined && requirements !== null) {
    const trimmed = typeof requirements === "string" ? requirements.trim() : "";
    if (typeof requirements !== "string" || trimmed.length > VENUE_REQUIREMENTS_MAX_LENGTH) {
      fieldErrors.venueRequirements = `The venue requirements must be ${VENUE_REQUIREMENTS_MAX_LENGTH} characters or fewer.`;
    } else if (trimmed !== "") {
      venueRequirements = trimmed;
    }
  }
  return { fieldErrors, expectedAttendance, venueRequirements };
}

/**
 * SCRUM-98/AC2 (98-S10, 98-S11): more people expected than the venue holds. A warning only, never a
 * refusal (32-S9). With either number unknown there is nothing to warn about.
 */
export function exceedsCapacity(expectedAttendance: number | null | undefined, maxCapacity: number | null | undefined): boolean {
  if (expectedAttendance == null || maxCapacity == null) return false;
  return expectedAttendance > maxCapacity;
}

export type ParsedVenueBookingInput =
  | { ok: true; data: VenueBookingInput }
  | { ok: false; fieldErrors: Record<string, string> };

/** Validates a request body. `now` is injected so tests (and the server clock) control "in the past". */
export function parseVenueBookingInput(body: unknown, now: Date): ParsedVenueBookingInput {
  const own = ownDetails(body);
  const parsed = inputShape.safeParse(body ?? {});
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = { ...own.fieldErrors };
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const { venueId, date, startTime, endTime } = parsed.data;
  const fieldErrors: Record<string, string> = { ...own.fieldErrors };
  if (endTime <= startTime) fieldErrors.endTime = "End time must be after the start time.";

  const start = sgtToUtc(date, startTime);
  const end = sgtToUtc(date, endTime);
  if (Number.isNaN(start.getTime())) fieldErrors.date = "Enter a valid date.";
  else if (start.getTime() < now.getTime()) fieldErrors.startTime = "The start time must not be in the past.";

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  const data: VenueBookingInput = { venueId, date, startTime, endTime, start, end };
  if (own.expectedAttendance !== undefined) data.expectedAttendance = own.expectedAttendance;
  if (own.venueRequirements !== undefined) data.venueRequirements = own.venueRequirements;
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// 39-S2: a rejection needs a reason, 1 to 500 characters once trimmed. Same schema in the reject
// form (apps/web) and the API. Unknown keys are stripped, so SCRUM-40 can add an optional
// `suggestion` to this object without breaking existing callers.
// ---------------------------------------------------------------------------

export const REJECTION_REASON_MAX_LENGTH = 500;

const rejectionShape = z.object({
  reason: z
    .string({ required_error: "Enter a reason for the rejection.", invalid_type_error: "Enter a reason for the rejection." })
    .trim()
    .min(1, "Enter a reason for the rejection.")
    .max(REJECTION_REASON_MAX_LENGTH, `The reason must be ${REJECTION_REASON_MAX_LENGTH} characters or fewer.`),
});

export type ParsedRejectionInput =
  | { ok: true; data: { reason: string } }
  | { ok: false; fieldErrors: Record<string, string> };

/** Validates a reject body. The reason comes back trimmed. */
export function parseRejectionInput(body: unknown): ParsedRejectionInput {
  // Anything that is not an object is treated as an empty one, so the error is always keyed `reason`.
  const parsed = rejectionShape.safeParse(typeof body === "object" && body !== null ? body : {});
  if (parsed.success) return { ok: true, data: { reason: parsed.data.reason } };
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
  return { ok: false, fieldErrors };
}
