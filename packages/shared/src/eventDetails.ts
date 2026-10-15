import { sgtToUtc, utcToSgt } from "./venueBooking";

// SCRUM-111 (docs/specs/edit-event-details.md): the assigned coordinator edits an event's planning information. The form
// (apps/web) and event-service validate with the same function, so they agree.

// ---------------------------------------------------------------------------
// AC1, AC2: ordinary and important fields, by their events column. Important ones may affect existing venue or equipment
// arrangements (the brief's "Impact of Event Changes": date, time, attendance, venue and equipment requirements, plus the
// story's layout and accessibility). SCRUM-112 and SCRUM-113 act on important changes.
// ---------------------------------------------------------------------------

export const EVENT_ORDINARY_FIELDS = ["name", "description", "purpose", "event_category_id"] as const;

export const EVENT_IMPORTANT_FIELDS = [
  "preferred_start_datetime",
  "preferred_end_datetime",
  "expected_attendance",
  "preferred_room_layout_id",
  "accessibility_requirements",
  "venue_requirements",
  "equipment_requirements_notes",
] as const;

export type EventDetailsField = (typeof EVENT_ORDINARY_FIELDS)[number] | (typeof EVENT_IMPORTANT_FIELDS)[number];

export function isImportantEventField(field: string): boolean {
  return (EVENT_IMPORTANT_FIELDS as readonly string[]).includes(field);
}

/** AC4: how each field is named in the change history (and on the form). */
export const EVENT_FIELD_LABELS: Record<EventDetailsField, string> = {
  name: "Event name",
  description: "Description",
  purpose: "Purpose",
  event_category_id: "Category",
  preferred_start_datetime: "Start",
  preferred_end_datetime: "End",
  expected_attendance: "Expected attendance",
  preferred_room_layout_id: "Room layout",
  accessibility_requirements: "Accessibility needs",
  venue_requirements: "Venue requirements",
  equipment_requirements_notes: "Equipment requirements",
};

/** AC2: the edit form's boxes for the important fields, so the form can mark them. */
export const EVENT_IMPORTANT_FORM_FIELDS = [
  "date",
  "startTime",
  "endDate",
  "endTime",
  "expectedAttendance",
  "roomLayoutId",
  "accessibilityRequirements",
  "venueRequirements",
  "equipmentRequirements",
] as const;

/** The edit form's values, as parseEventDetailsInput takes them (dates and times in Singapore time; empty means none). */
export type EventDetailsFormValues = {
  name: string;
  description: string;
  purpose: string;
  categoryId: string;
  date: string;
  startTime: string;
  endDate: string;
  endTime: string;
  expectedAttendance: number | "";
  roomLayoutId: string;
  accessibilityRequirements: string;
  venueRequirements: string;
  equipmentRequirements: string;
};

/** AC2: what the edit form starts with, from the event as stored. */
export function eventDetailsFormValues(event: CurrentEventDetails): EventDetailsFormValues {
  const start = event.preferred_start_datetime ? utcToSgt(new Date(event.preferred_start_datetime)) : null;
  const end = event.preferred_end_datetime ? utcToSgt(new Date(event.preferred_end_datetime)) : null;
  return {
    name: event.name,
    description: event.description ?? "",
    purpose: event.purpose ?? "",
    categoryId: event.event_category_id ?? "",
    date: start?.date ?? "",
    startTime: start?.time ?? "",
    endDate: end?.date ?? "",
    endTime: end?.time ?? "",
    expectedAttendance: event.expected_attendance ?? "",
    roomLayoutId: event.preferred_room_layout_id ?? "",
    accessibilityRequirements: event.accessibility_requirements ?? "",
    venueRequirements: event.venue_requirements ?? "",
    equipmentRequirements: event.equipment_requirements_notes ?? "",
  };
}

/**
 * The details a form started from, back in the stored shape, so the form can run parseEventDetailsInput before sending
 * (111-S10) and see what changed. Times are rebuilt from the Singapore date and time.
 */
export function eventDetailsFromFormValues(values: EventDetailsFormValues): CurrentEventDetails {
  const at = (date: string, time: string) => (date && time ? sgtToUtc(date, time).toISOString() : null);
  const text = (value: string) => (value.trim() === "" ? null : value.trim());
  return {
    name: values.name,
    description: text(values.description),
    purpose: text(values.purpose),
    event_category_id: values.categoryId || null,
    preferred_start_datetime: at(values.date, values.startTime),
    preferred_end_datetime: at(values.endDate, values.endTime),
    expected_attendance: values.expectedAttendance === "" ? null : values.expectedAttendance,
    preferred_room_layout_id: values.roomLayoutId || null,
    accessibility_requirements: text(values.accessibilityRequirements),
    venue_requirements: text(values.venueRequirements),
    equipment_requirements_notes: text(values.equipmentRequirements),
  };
}

/** The event's editable details as stored (timestamps as ISO strings). */
export type CurrentEventDetails = {
  name: string;
  description: string | null;
  purpose: string | null;
  event_category_id: string | null;
  preferred_start_datetime: string | null;
  preferred_end_datetime: string | null;
  expected_attendance: number | null;
  preferred_room_layout_id: string | null;
  accessibility_requirements: string | null;
  venue_requirements: string | null;
  equipment_requirements_notes: string | null;
};

export type EventDetailsChanges = Partial<{ [F in EventDetailsField]: { from: unknown; to: unknown } }>;

export type ParsedEventDetailsInput =
  | { ok: true; data: { changes: EventDetailsChanges; important: boolean } }
  | { ok: false; noChanges: boolean; fieldErrors: Record<string, string> };

export const EVENT_NAME_MAX_LENGTH = 200;
export const EVENT_TEXT_MAX_LENGTH = 2000;

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const isBlank = (value: unknown) => value === undefined || value === null || (typeof value === "string" && value.trim() === "");

/** An optional text field: trimmed, empty means null, at most `max` characters. */
function optionalText(value: unknown, max: number, key: string, label: string, errors: Record<string, string>): string | null {
  if (isBlank(value)) return null;
  const text = String(value).trim();
  if (text.length > max) errors[key] = `The ${label} must be ${max} characters or fewer.`;
  return text;
}

/**
 * AC3: validates the edit form against the event's current details and returns what changed, each as `{ from, to }`, and
 * whether any important field changed (AC2, AC4). Nothing different is `noChanges` (no history row for it). `now` is injected
 * so tests and the server clock control "in the past". Body keys: name, description, purpose, categoryId, date, startTime,
 * endDate, endTime (Singapore time), expectedAttendance, roomLayoutId, accessibilityRequirements, venueRequirements,
 * equipmentRequirements.
 */
export function parseEventDetailsInput(body: unknown, current: CurrentEventDetails, now: Date): ParsedEventDetailsInput {
  if (typeof body !== "object" || body === null) {
    return { ok: false, noChanges: false, fieldErrors: { form: "Fill in the event details." } };
  }
  const input = body as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const next: Partial<CurrentEventDetails> = {};

  // ordinary: the name is required
  if (isBlank(input.name)) errors.name = "Enter the event name.";
  else {
    next.name = String(input.name).trim();
    if (next.name.length > EVENT_NAME_MAX_LENGTH) errors.name = `The name must be ${EVENT_NAME_MAX_LENGTH} characters or fewer.`;
  }
  next.description = optionalText(input.description, EVENT_TEXT_MAX_LENGTH, "description", "description", errors);
  next.purpose = optionalText(input.purpose, EVENT_TEXT_MAX_LENGTH, "purpose", "purpose", errors);
  next.event_category_id = isBlank(input.categoryId) ? null : String(input.categoryId);

  // important: the dates and times (Singapore time), all required
  const timing = (value: unknown, pattern: RegExp, key: string, missing: string, bad: string) => {
    if (isBlank(value)) errors[key] = missing;
    else if (!pattern.test(String(value).trim())) errors[key] = bad;
    else return String(value).trim();
    return undefined;
  };
  const date = timing(input.date, DATE, "date", "Enter a date.", "Enter the date as YYYY-MM-DD.");
  const startTime = timing(input.startTime, TIME, "startTime", "Enter a start time.", "Enter the start time as HH:MM.");
  const endDate = timing(input.endDate, DATE, "endDate", "Enter an end date.", "Enter the end date as YYYY-MM-DD.");
  const endTime = timing(input.endTime, TIME, "endTime", "Enter an end time.", "Enter the end time as HH:MM.");
  if (date && startTime && endDate && endTime) {
    const start = sgtToUtc(date, startTime);
    const end = sgtToUtc(endDate, endTime);
    if (end.getTime() <= start.getTime()) {
      if (endDate < date) errors.endDate = "End date must not be before the date.";
      else errors.endTime = "End time must be after the start time.";
    }
    const startIso = start.toISOString();
    // only a start that is being changed is checked against today, so an event that already started can still be edited
    const startChanged = !current.preferred_start_datetime || new Date(current.preferred_start_datetime).toISOString() !== startIso;
    if (startChanged) {
      if (date < utcToSgt(now).date) errors.date = "The date must not be in the past.";
      else if (start.getTime() < now.getTime()) errors.startTime = "The start time must not be in the past.";
    }
    next.preferred_start_datetime = startIso;
    next.preferred_end_datetime = end.toISOString();
  }

  // important: attendance, a whole number of 1 or more (typed digits are accepted)
  const rawAttendance = input.expectedAttendance;
  if (isBlank(rawAttendance)) errors.expectedAttendance = "Enter the expected attendance.";
  else {
    const attendance =
      typeof rawAttendance === "number" ? rawAttendance : /^\s*\d+\s*$/.test(String(rawAttendance)) ? Number(rawAttendance) : NaN;
    if (!Number.isSafeInteger(attendance) || attendance < 1) {
      errors.expectedAttendance = "Enter the expected attendance as a whole number of 1 or more.";
    } else next.expected_attendance = attendance;
  }

  // important: the optional ones
  next.preferred_room_layout_id = isBlank(input.roomLayoutId) ? null : String(input.roomLayoutId);
  next.accessibility_requirements = optionalText(input.accessibilityRequirements, EVENT_TEXT_MAX_LENGTH, "accessibilityRequirements", "accessibility needs", errors);
  next.venue_requirements = optionalText(input.venueRequirements, EVENT_TEXT_MAX_LENGTH, "venueRequirements", "venue requirements", errors);
  next.equipment_requirements_notes = optionalText(input.equipmentRequirements, EVENT_TEXT_MAX_LENGTH, "equipmentRequirements", "equipment requirements", errors);

  if (Object.keys(errors).length > 0) return { ok: false, noChanges: false, fieldErrors: errors };

  // AC4: each field that differs, as { from, to }
  const changes: EventDetailsChanges = {};
  for (const field of [...EVENT_ORDINARY_FIELDS, ...EVENT_IMPORTANT_FIELDS]) {
    const before = current[field];
    const after = next[field];
    const same =
      field === "preferred_start_datetime" || field === "preferred_end_datetime"
        ? (before === null ? null : new Date(before as string).toISOString()) === after
        : before === after;
    if (!same) changes[field] = { from: before, to: after };
  }
  if (Object.keys(changes).length === 0) return { ok: false, noChanges: true, fieldErrors: {} };

  return { ok: true, data: { changes, important: Object.keys(changes).some(isImportantEventField) } };
}
