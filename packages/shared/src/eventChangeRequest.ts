import { isEventStatus } from "./eventStatus";
import { sgtToUtc, utcToSgt } from "./venueBooking";

// Event change request rules shared by event-service and apps/web (docs/specs/event-change-request.md, SCRUM-66).
// Event statuses must match the event_status enum in supabase/migrations/01_schema.sql.

// ---------------------------------------------------------------------------
// 66-S1..S3 (AC1-AC3): which event statuses allow a change request. Must match the INSERT policy
// in supabase/migrations/15_event_change_requests_insert.sql.
// ---------------------------------------------------------------------------

export const CHANGE_REQUEST_BLOCKED_STATUSES = ["draft", "cancelled", "rejected", "completed"] as const;

export function canRequestChange(eventStatus: string): boolean {
  return isEventStatus(eventStatus) && !(CHANGE_REQUEST_BLOCKED_STATUSES as readonly string[]).includes(eventStatus);
}

export const CHANGE_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

export const CHANGE_REQUEST_MESSAGES = {
  NOT_ALLOWED: "A change request can't be made for an event that is a draft, cancelled, rejected or completed.",
  NO_CHANGES: "No changes were made, so nothing was submitted.",
  SAVE_FAILED: "We couldn't save your change request. Please try again, and contact support if it keeps happening.",
  SUBMITTED: "Your change request was submitted for approval. The event stays as it is until it is approved.",
} as const;

export const CHANGE_REQUEST_TEXT_MAX_LENGTH = 2000;

// ---------------------------------------------------------------------------
// 66-S8..S10 (AC8-AC10): validation, identical in the form (apps/web) and the API (event-service).
// ---------------------------------------------------------------------------

/** The event as the parser needs to see it (the GET /events/:id fields, plus venue requirements held only in change requests). */
export interface CurrentEventForChange {
  expected_attendance: number | null;
  preferred_start_datetime: string | null;
  preferred_end_datetime: string | null;
  equipment_requirements_notes: string | null;
  venue_requirements?: string | null;
}

export type ChangeRequestField =
  | "expected_attendance"
  | "preferred_start_datetime"
  | "preferred_end_datetime"
  | "venue_requirements"
  | "equipment_requirements_notes";

export interface FieldChange {
  from: string | number | null;
  to: string | number | null;
}

export interface ChangeRequestData {
  /** Only the fields that differ from the current event. */
  proposed_changes: Partial<Record<ChangeRequestField, FieldChange>>;
  /** The reason the organiser gave, or "Changed: expected attendance, start time" when none. */
  change_description: string;
}

export type ParsedChangeRequestInput =
  | { ok: true; data: ChangeRequestData }
  | { ok: false; noChanges: boolean; fieldErrors: Record<string, string> };

const FIELD_LABELS: Record<ChangeRequestField, string> = {
  expected_attendance: "expected attendance",
  preferred_start_datetime: "start time",
  preferred_end_datetime: "end time",
  venue_requirements: "venue requirements",
  equipment_requirements_notes: "equipment requirements",
};

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const isMissing = (value: unknown) => value === undefined || value === null;

function textField(
  value: unknown,
  label: string,
  key: string,
  fieldErrors: Record<string, string>,
): string | undefined {
  if (isMissing(value)) return undefined;
  if (typeof value !== "string") {
    fieldErrors[key] = `Enter the ${label} as text.`;
    return undefined;
  }
  const text = value.trim();
  if (text.length > CHANGE_REQUEST_TEXT_MAX_LENGTH) {
    fieldErrors[key] = `The ${label} must be ${CHANGE_REQUEST_TEXT_MAX_LENGTH} characters or fewer.`;
    return undefined;
  }
  return text;
}

/**
 * Validates a change request body against the event's current details. A field that is left out
 * (undefined or null) is unchanged. `now` is injected so tests and the server clock control "past".
 * Body keys: expectedAttendance, date, endDate (defaults to date), startTime, endTime (Singapore time),
 * venueRequirements, equipmentRequirements, reason.
 */
export function parseEventChangeRequestInput(
  body: unknown,
  current: CurrentEventForChange,
  now: Date,
): ParsedChangeRequestInput {
  const input = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};
  const proposed: ChangeRequestData["proposed_changes"] = {};

  // AC5: a positive whole number.
  const rawAttendance = input.expectedAttendance;
  if (!isMissing(rawAttendance)) {
    const attendance =
      typeof rawAttendance === "number"
        ? rawAttendance
        : typeof rawAttendance === "string" && /^\s*\d+\s*$/.test(rawAttendance)
          ? Number(rawAttendance)
          : NaN;
    if (!Number.isSafeInteger(attendance) || attendance <= 0) {
      fieldErrors.expectedAttendance = "Expected attendance must be a positive whole number.";
    } else if (attendance !== current.expected_attendance) {
      proposed.expected_attendance = { from: current.expected_attendance, to: attendance };
    }
  }

  // AC8-AC10: date and times, in Singapore time.
  const currentStart = current.preferred_start_datetime ? utcToSgt(new Date(current.preferred_start_datetime)) : null;
  const currentEnd = current.preferred_end_datetime ? utcToSgt(new Date(current.preferred_end_datetime)) : null;

  const date = isMissing(input.date) ? undefined : input.date;
  const endDateInput = isMissing(input.endDate) ? undefined : input.endDate;
  const startTime = isMissing(input.startTime) ? undefined : input.startTime;
  const endTime = isMissing(input.endTime) ? undefined : input.endTime;
  const timingGiven = [date, endDateInput, startTime, endTime].some((v) => v !== undefined);

  if (timingGiven) {
    const check = (value: unknown, pattern: RegExp, key: string, missing: string, bad: string) => {
      if (typeof value !== "string" || value === "") fieldErrors[key] = missing;
      else if (!pattern.test(value)) fieldErrors[key] = bad;
      else return value;
      return undefined;
    };
    const d1 = check(date ?? currentStart?.date, DATE, "date", "Enter a date.", "Enter the date as YYYY-MM-DD.");
    const d2 = check(
      endDateInput ?? date ?? currentEnd?.date,
      DATE,
      "endDate",
      "Enter an end date.",
      "Enter the end date as YYYY-MM-DD.",
    );
    const t1 = check(startTime ?? currentStart?.time, TIME, "startTime", "Enter a start time.", "Enter the start time as HH:MM.");
    const t2 = check(endTime ?? currentEnd?.time, TIME, "endTime", "Enter an end time.", "Enter the end time as HH:MM.");

    if (d1 && d2 && t1 && t2) {
      const start = sgtToUtc(d1, t1);
      const end = sgtToUtc(d2, t2);
      if (Number.isNaN(start.getTime())) fieldErrors.date = "Enter a valid date.";
      else if (Number.isNaN(end.getTime())) fieldErrors.endDate = "Enter a valid end date.";
      else {
        // AC10: the end (date and time) must be after the start. An end date before the date is named on the End date.
        if (end.getTime() <= start.getTime()) {
          if (d2 < d1) fieldErrors.endDate = "End date must not be before the date.";
          else fieldErrors.endTime = "End time must be after the start time.";
        }
        const startChanged = !currentStart || d1 !== currentStart.date || t1 !== currentStart.time;
        // AC9: only when the date or start time is being changed (an unchanged start is not re-checked).
        if (startChanged) {
          if (d1 < utcToSgt(now).date) fieldErrors.date = "The date must not be in the past.";
          else if (start.getTime() < now.getTime()) fieldErrors.startTime = "The start time must not be in the past.";
        }
        if (startChanged) {
          proposed.preferred_start_datetime = { from: current.preferred_start_datetime, to: start.toISOString() };
        }
        if (!currentEnd || d2 !== currentEnd.date || t2 !== currentEnd.time) {
          proposed.preferred_end_datetime = { from: current.preferred_end_datetime, to: end.toISOString() };
        }
      }
    }
  }

  // AC8: venue and equipment requirements.
  const venue = textField(input.venueRequirements, "venue requirements", "venueRequirements", fieldErrors);
  if (venue !== undefined && venue !== (current.venue_requirements ?? "").trim()) {
    proposed.venue_requirements = { from: current.venue_requirements ?? null, to: venue };
  }
  const equipment = textField(input.equipmentRequirements, "equipment requirements", "equipmentRequirements", fieldErrors);
  if (equipment !== undefined && equipment !== (current.equipment_requirements_notes ?? "").trim()) {
    proposed.equipment_requirements_notes = { from: current.equipment_requirements_notes, to: equipment };
  }

  const reason = textField(input.reason, "reason", "reason", fieldErrors);

  if (Object.keys(fieldErrors).length > 0) return { ok: false, noChanges: false, fieldErrors };

  // AC4: nothing differs from the current event.
  const fields = Object.keys(proposed) as ChangeRequestField[];
  if (fields.length === 0) return { ok: false, noChanges: true, fieldErrors: {} };

  const change_description = reason || `Changed: ${fields.map((f) => FIELD_LABELS[f]).join(", ")}`;
  return { ok: true, data: { proposed_changes: proposed, change_description } };
}

// ---------------------------------------------------------------------------
// SCRUM-176 (docs/specs/conflicting-change-request.md): a new request may not change something a pending request already
// changes. The customer said in the Week 9 Q&A that active change requests "should be processed by the Coordinator before
// additional major conflicting change requests are submitted." event-service refuses with these; the form warns with them.
// ---------------------------------------------------------------------------

/** The things a request can change, in the order they are named. Start and end time are one thing: moving an event changes both. */
const CHANGE_REQUEST_THINGS: { label: string; fields: ChangeRequestField[] }[] = [
  { label: "expected attendance", fields: ["expected_attendance"] },
  { label: "date and time", fields: ["preferred_start_datetime", "preferred_end_datetime"] },
  { label: "venue requirements", fields: ["venue_requirements"] },
  { label: "equipment requirements", fields: ["equipment_requirements_notes"] },
];

/** The things a request's proposed_changes touches. Anything unreadable touches nothing, so it never causes a refusal. */
function thingsChanged(proposedChanges: unknown): Set<string> {
  if (!proposedChanges || typeof proposedChanges !== "object" || Array.isArray(proposedChanges)) return new Set();
  const keys = Object.keys(proposedChanges);
  return new Set(CHANGE_REQUEST_THINGS.filter((t) => t.fields.some((f) => keys.includes(f))).map((t) => t.label));
}

/** What the pending requests change between them, once each, in order (176-S8). */
export function pendingChangeThings(pendingProposedChanges: unknown[]): string[] {
  const waiting = new Set(pendingProposedChanges.flatMap((p) => [...thingsChanged(p)]));
  return CHANGE_REQUEST_THINGS.map((t) => t.label).filter((label) => waiting.has(label));
}

/** What a new request shares with the pending ones (AC1); empty when it changes only other things (AC2). */
export function changeRequestConflicts(proposedChanges: unknown, pendingProposedChanges: unknown[]): string[] {
  const asked = thingsChanged(proposedChanges);
  return pendingChangeThings(pendingProposedChanges).filter((label) => asked.has(label));
}

/** "a", "a and b", "a, b and c". */
const listInEnglish = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** AC1: the refusal, naming what is waiting and pointing to the coordinator (there is no withdraw button, decision 4). */
export function conflictingRequestMessage(things: string[]): string {
  return (
    `A change to the ${listInEnglish(things)} is already waiting for your coordinator. ` +
    `Ask your coordinator about it before requesting another change to ${things.length > 1 ? "them" : "it"}.`
  );
}
