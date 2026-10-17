import { z } from "zod";
import { sgtToUtc, utcToSgt } from "./venueBooking";

// SCRUM-105 (docs/specs/venue-unavailability.md): marking a venue unavailable for a period with a reason. The checks and
// the wording live here so the form (apps/web) and venue-service use the very same code and can never disagree.
// Dependency free apart from zod and venueBooking's Singapore time helpers.

// ---------------------------------------------------------------------------
// Reasons. The database enum `venue_unavailability_reason` has maintenance, renovation, safety, internal_activity and
// other (migration 01); migration 38 adds equipment_failure.
// ---------------------------------------------------------------------------

/** The reasons Venue Staff can choose, in the order the Jira story lists them (105-S2). */
export const SELECTABLE_UNAVAILABILITY_REASONS = ["maintenance", "equipment_failure", "renovation", "safety", "other"] as const;

/** `internal_activity` is in older seed data. It is shown but cannot be chosen for a new period. */
export const UNAVAILABILITY_REASONS = [...SELECTABLE_UNAVAILABILITY_REASONS, "internal_activity"] as const;

export type SelectableUnavailabilityReason = (typeof SELECTABLE_UNAVAILABILITY_REASONS)[number];
export type UnavailabilityReason = (typeof UNAVAILABILITY_REASONS)[number];

/** The words shown for each reason. The enum value `safety` reads "Safety concern". */
export const UNAVAILABILITY_REASON_LABELS: Record<UnavailabilityReason, string> = {
  maintenance: "Maintenance",
  equipment_failure: "Equipment failure",
  renovation: "Renovation",
  safety: "Safety concern",
  other: "Other",
  internal_activity: "Internal activity",
};

export function isUnavailabilityReason(value: unknown): value is UnavailabilityReason {
  return typeof value === "string" && (UNAVAILABILITY_REASONS as readonly string[]).includes(value);
}

export function isSelectableUnavailabilityReason(value: unknown): value is SelectableUnavailabilityReason {
  return typeof value === "string" && (SELECTABLE_UNAVAILABILITY_REASONS as readonly string[]).includes(value);
}

/** The label for a reason; undefined for a value this feature does not know. */
export function unavailabilityReasonLabel(reason: string): string | undefined {
  return isUnavailabilityReason(reason) ? UNAVAILABILITY_REASON_LABELS[reason] : undefined;
}

/** 105-S6: only Venue Staff may mark a venue unavailable; coordinators see the periods read-only. */
export function canMarkVenueUnavailable(role: string | undefined): boolean {
  return role === "venue_staff";
}

// ---------------------------------------------------------------------------
// Short Singapore dates for messages: "14 Nov 08:00".
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** An instant in Singapore time as "14 Nov 08:00" (day without a leading zero, English month, 24-hour clock). */
export function formatShortSgt(instant: Date): string {
  const { date, time } = utcToSgt(instant);
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${time}`;
}

/** 105-S4: the refusal for a request that overlaps a block. It names the block's own period, never the reason. */
export function unavailableMessage(venueName: string, start: Date, end: Date): string {
  return `${venueName} is unavailable from ${formatShortSgt(start)} to ${formatShortSgt(end)}`;
}

// ---------------------------------------------------------------------------
// 105-S1, 105-S6: a block as the API returns it.
// ---------------------------------------------------------------------------

/** A block as read from the database, with the name of the member of staff who recorded it. */
export interface UnavailabilityBlockRow {
  id: string;
  start: Date;
  end: Date;
  reason: string;
  notes: string | null;
  recordedByName: string | null;
  recordedAt: Date;
}

/** The JSON shape of a block (Singapore date and time fields, UTC instants, the reason's label). */
export interface UnavailabilityBlockView {
  id: string;
  start: string;
  end: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  reason: string;
  reasonLabel: string;
  recordedAt: string;
  /** Venue staff only. */
  notes?: string | null;
  /** Venue staff only: the name of the member of staff who recorded it. */
  recordedBy?: string | null;
}

/**
 * The block for a response. Coordinators see the period and the reason label; `notes` and `recordedBy` are left out unless
 * `forStaff` (open question 3 in the spec: row-level security cannot hide a single column, so the service does).
 */
export function unavailabilityBlockView(row: UnavailabilityBlockRow, forStaff: boolean): UnavailabilityBlockView {
  const start = utcToSgt(row.start);
  const end = utcToSgt(row.end);
  const view: UnavailabilityBlockView = {
    id: row.id,
    start: row.start.toISOString(),
    end: row.end.toISOString(),
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    reason: row.reason,
    reasonLabel: unavailabilityReasonLabel(row.reason) ?? row.reason,
    recordedAt: row.recordedAt.toISOString(),
  };
  if (forStaff) {
    view.notes = row.notes;
    view.recordedBy = row.recordedByName;
  }
  return view;
}

// ---------------------------------------------------------------------------
// 105-S1..S3: input validation, identical in the form (apps/web) and the API (venue-service).
// ---------------------------------------------------------------------------

export const UNAVAILABILITY_NOTES_MAX_LENGTH = 500;

/** [PROPOSED] 105 open question: notes are required when the reason is Other, so the period is never unexplained. */
export const NOTES_REQUIRED_FOR_OTHER = true;

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const inputShape = z.object({
  startDate: z.string({ required_error: "Enter a start date." }).regex(DATE, "Enter the start date as YYYY-MM-DD."),
  startTime: z.string({ required_error: "Enter a start time." }).regex(TIME, "Enter the start time as HH:MM."),
  endDate: z.string({ required_error: "Enter an end date." }).regex(DATE, "Enter the end date as YYYY-MM-DD."),
  endTime: z.string({ required_error: "Enter an end time." }).regex(TIME, "Enter the end time as HH:MM."),
});

export interface UnavailabilityInput {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  /** The period as UTC instants (the fields above are Singapore time, DR3). */
  start: Date;
  end: Date;
  reason: SelectableUnavailabilityReason;
  /** Trimmed; undefined when left blank. */
  notes?: string;
}

export type ParsedUnavailabilityInput =
  | { ok: true; data: UnavailabilityInput }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * Validates a mark-unavailable body. Every problem is reported at once, keyed by field: `startDate`, `startTime`,
 * `endDate`, `endTime`, `reason`, `notes`. Dates and times are Singapore time. A period that starts in the past is allowed
 * (a venue can break today) [PROPOSED]. Nothing is saved when any field is wrong (105-S2, 105-S3).
 */
export function parseUnavailabilityInput(body: unknown): ParsedUnavailabilityInput {
  const raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const fieldErrors: Record<string, string> = {};

  const parsed = inputShape.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
  }

  // 105-S2: a reason is required, and must be one of the five on offer.
  const reason = raw.reason;
  let chosen: SelectableUnavailabilityReason | undefined;
  if (reason === undefined || reason === null || (typeof reason === "string" && reason.trim() === "")) {
    fieldErrors.reason = "Choose a reason.";
  } else if (isSelectableUnavailabilityReason(reason)) {
    chosen = reason;
  } else {
    fieldErrors.reason = "Choose one of the listed reasons.";
  }

  let notes: string | undefined;
  if (raw.notes !== undefined && raw.notes !== null) {
    const trimmed = typeof raw.notes === "string" ? raw.notes.trim() : "";
    if (typeof raw.notes !== "string" || trimmed.length > UNAVAILABILITY_NOTES_MAX_LENGTH) {
      fieldErrors.notes = `The notes must be ${UNAVAILABILITY_NOTES_MAX_LENGTH} characters or fewer.`;
    } else if (trimmed !== "") {
      notes = trimmed;
    }
  }
  if (NOTES_REQUIRED_FOR_OTHER && chosen === "other" && notes === undefined && fieldErrors.notes === undefined) {
    fieldErrors.notes = "Enter notes describing the reason.";
  }

  if (!parsed.success) return { ok: false, fieldErrors };
  const { startDate, startTime, endDate, endTime } = parsed.data;
  const start = sgtToUtc(startDate, startTime);
  const end = sgtToUtc(endDate, endTime);
  // Date.parse rolls 2026-02-31 over to March, so a real date is one that survives the round trip.
  const startReal = !Number.isNaN(start.getTime()) && utcToSgt(start).date === startDate;
  const endReal = !Number.isNaN(end.getTime()) && utcToSgt(end).date === endDate;
  if (!startReal) fieldErrors.startDate = "Enter a valid start date.";
  if (!endReal) fieldErrors.endDate = "Enter a valid end date.";
  // 105-S3: the end must follow the start (equal is not after).
  if (startReal && endReal && end.getTime() <= start.getTime()) fieldErrors.endTime = "The end must be after the start.";

  if (Object.keys(fieldErrors).length > 0 || chosen === undefined) return { ok: false, fieldErrors };
  const data: UnavailabilityInput = { startDate, startTime, endDate, endTime, start, end, reason: chosen };
  if (notes !== undefined) data.notes = notes;
  return { ok: true, data };
}
