// SCRUM-53: saving an event request as a draft (docs/specs/SCRUM-53-save-draft-event-request.md).
// A draft keeps whatever the organiser has filled in so far, so nothing is required. What is still refused is what the
// events table itself would refuse, or a value of the wrong type. The submission rules (parseEventRequest, SCRUM-49) are not applied.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TEXT_FIELDS = [
  "name",
  "purpose",
  "description",
  "venue_requirements",
  "accessibility_requirements",
  "equipment_requirements_notes",
] as const;
const DATE_FIELDS = ["preferred_start_datetime", "preferred_end_datetime", "registration_opens_at", "registration_closes_at"] as const;
const COUNT_FIELDS = ["expected_attendance", "registration_capacity"] as const;

export const EVENT_DRAFT_FIELDS = [
  ...TEXT_FIELDS,
  ...DATE_FIELDS,
  ...COUNT_FIELDS,
  "preferred_room_layout_id",
  "registration_required",
] as const;

/** The draft as stored: an empty field is null. `name` null means the database names it "Untitled draft". */
export interface EventDraftInput {
  name: string | null;
  purpose: string | null;
  description: string | null;
  preferred_start_datetime: string | null;
  preferred_end_datetime: string | null;
  expected_attendance: number | null;
  venue_requirements: string | null;
  preferred_room_layout_id: string | null;
  accessibility_requirements: string | null;
  equipment_requirements_notes: string | null;
  registration_required: boolean;
  registration_capacity: number | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
}

type FieldErrors = Record<string, string>;
export type ParsedEventDraft = { ok: true; data: EventDraftInput } | { ok: false; fieldErrors: FieldErrors };

const isEmpty = (value: unknown) => value === undefined || value === null || (typeof value === "string" && value.trim() === "");

/**
 * SCRUM-53/AC2: validate a draft. Missing, null, empty and blank values are accepted and stored as null. Returns every bad
 * field at once, keyed by field name, in the same shape as parseEventRequest. Fields that are not part of the request are dropped.
 */
export function parseEventRequestDraft(body: unknown): ParsedEventDraft {
  const source: Record<string, unknown> = body === undefined || body === null ? {} : (body as Record<string, unknown>);
  if (typeof source !== "object" || Array.isArray(source)) {
    return { ok: false, fieldErrors: { body: "Send the event request as an object." } };
  }

  const data: Record<string, unknown> = {};
  const errors: FieldErrors = {};

  for (const field of TEXT_FIELDS) {
    const value = source[field];
    if (isEmpty(value)) data[field] = null;
    else if (typeof value !== "string") errors[field] = "Enter this as text.";
    else data[field] = value.trim();
  }

  for (const field of DATE_FIELDS) {
    const value = source[field];
    if (isEmpty(value)) data[field] = null;
    else if (typeof value !== "string" || Number.isNaN(Date.parse(value))) errors[field] = "Enter a valid date and time.";
    else data[field] = value;
  }

  for (const field of COUNT_FIELDS) {
    const value = source[field];
    if (isEmpty(value)) data[field] = null;
    else if (typeof value !== "number" || !Number.isInteger(value) || value < 0) errors[field] = "Enter a whole number, 0 or more.";
    else data[field] = value;
  }

  const layout = source.preferred_room_layout_id;
  if (isEmpty(layout)) data.preferred_room_layout_id = null;
  else if (typeof layout !== "string" || !UUID.test(layout)) errors.preferred_room_layout_id = "Choose a room layout.";
  else data.preferred_room_layout_id = layout;

  const registration = source.registration_required;
  if (registration === undefined || registration === null) data.registration_required = false;
  else if (typeof registration !== "boolean") errors.registration_required = "Say whether attendee registration is needed.";
  else data.registration_required = registration;

  // The table's two comparison checks, only when both sides are given and valid (otherwise they already have a message)
  const later = (earlier: string, end: string, message: string) => {
    const a = data[earlier];
    const b = data[end];
    if (typeof a === "string" && typeof b === "string" && Date.parse(b) <= Date.parse(a)) errors[end] = message;
  };
  later("preferred_start_datetime", "preferred_end_datetime", "The preferred end must be after the start.");
  later("registration_opens_at", "registration_closes_at", "Registration must close after it opens.");

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  return { ok: true, data: data as unknown as EventDraftInput };
}
