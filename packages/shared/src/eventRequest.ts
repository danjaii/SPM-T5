import { z } from "zod";

// New event request rules shared by event-service and apps/web (docs/specs/SCRUM-49-create-submit-event-request.md).
// SCRUM-49/AC5: the same validation runs in the form (field flags, AC3) and in the API (422).

const text = (label: string) =>
  z
    .string({ required_error: `Enter the ${label}.`, invalid_type_error: `Enter the ${label} as text.` })
    .trim()
    .min(1, `Enter the ${label}.`);

const date = (label: string) =>
  z
    .string({ required_error: `Enter the ${label}.`, invalid_type_error: `Enter a valid ${label}.` })
    .refine((value) => !Number.isNaN(Date.parse(value)), `Enter a valid ${label}.`);

const wholeNumber = (label: string) =>
  z
    .number({ required_error: `Enter the ${label}.`, invalid_type_error: `${capitalise(label)} must be a whole number of at least 1.` })
    .int(`${capitalise(label)} must be a whole number of at least 1.`)
    .min(1, `${capitalise(label)} must be a whole number of at least 1.`);

function capitalise(label: string) {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Field-by-field rules. The rules that compare fields, or depend on registration, are in crossFieldErrors. */
const eventRequestFields = z.object({
  name: text("event name"),
  purpose: text("purpose"),
  description: text("description"),
  preferred_start_datetime: date("preferred start date and time"),
  preferred_end_datetime: date("preferred end date and time"),
  expected_attendance: wholeNumber("expected attendance"),
  venue_requirements: text("venue requirements"),
  preferred_room_layout_id: z
    .string({ required_error: "Choose a room layout.", invalid_type_error: "Choose a room layout." })
    .uuid("Choose a room layout."),
  // "None required" is a valid answer, an empty one is not
  accessibility_requirements: text('accessibility needs (enter "None required" if there are none)'),
  equipment_requirements_notes: text('equipment requirements (enter "None required" if there are none)'),
  registration_required: z.boolean({
    required_error: "Say whether attendee registration is needed.",
    invalid_type_error: "Say whether attendee registration is needed.",
  }),
  registration_capacity: wholeNumber("registration capacity").nullish(),
  registration_opens_at: date("registration opening date and time").nullish(),
  registration_closes_at: date("registration closing date and time").nullish(),
});

export type EventRequestInput = z.infer<typeof eventRequestFields>;

type Fields = Partial<Record<keyof EventRequestInput, unknown>>;
type FieldErrors = Record<string, string>;

const time = (value: unknown) => (typeof value === "string" ? Date.parse(value) : NaN);

/**
 * Rules that compare fields, or depend on registration being needed. A rule is skipped when the
 * fields it compares are missing or invalid by themselves: those already have their own message.
 * One message per field.
 */
function crossFieldErrors(d: Fields, now: Date): FieldErrors {
  const errors: FieldErrors = {};
  const start = time(d.preferred_start_datetime);
  const end = time(d.preferred_end_datetime);

  if (start <= now.getTime()) errors.preferred_start_datetime = "The preferred start must be in the future.";
  if (end <= start) errors.preferred_end_datetime = "The preferred end must be after the start.";

  if (d.registration_required === true) {
    if (d.registration_capacity == null) errors.registration_capacity = "Enter the registration capacity.";
    if (d.registration_opens_at == null) errors.registration_opens_at = "Enter the registration opening date and time.";
    if (d.registration_closes_at == null) errors.registration_closes_at = "Enter the registration closing date and time.";

    const opens = time(d.registration_opens_at);
    const closes = time(d.registration_closes_at);
    if (closes <= opens) errors.registration_closes_at = "Registration must close after it opens.";
    else if (closes > start) errors.registration_closes_at = "Registration must close by the event start.";
  }
  return errors;
}

/** The zod schema, for apps/web to reuse. The event-service route calls parseEventRequest. */
export const eventRequestSchema = eventRequestFields.superRefine((data, ctx) => {
  for (const [path, message] of Object.entries(crossFieldErrors(data, new Date()))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  }
});

export type ParsedEventRequest =
  | { ok: true; data: EventRequestInput }
  | { ok: false; fieldErrors: FieldErrors };

/**
 * SCRUM-49/AC5: validate a new event request. Returns every bad field at once, keyed by field name.
 * `now` is passed in so tests can fix the clock. Fields that are not part of the request are dropped.
 */
export function parseEventRequest(body: unknown, now: Date = new Date()): ParsedEventRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, fieldErrors: { body: "Send the event request as an object." } };
  }

  const parsed = eventRequestFields.safeParse(body);
  const fieldErrors: FieldErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0]);
      if (!(field in fieldErrors)) fieldErrors[field] = issue.message;
    }
  }

  // Compare only the values that passed their own check, so one mistake isn't reported twice
  const good: Fields = {};
  for (const key of Object.keys(eventRequestFields.shape) as (keyof EventRequestInput)[]) {
    if (!(key in fieldErrors)) good[key] = (body as Fields)[key];
  }
  for (const [field, message] of Object.entries(crossFieldErrors(good, now))) {
    if (!(field in fieldErrors)) fieldErrors[field] = message;
  }

  if (Object.keys(fieldErrors).length > 0 || !parsed.success) return { ok: false, fieldErrors };

  const data = parsed.data;
  if (!data.registration_required) {
    // no registration: nothing about capacity or a window is kept
    data.registration_capacity = null;
    data.registration_opens_at = null;
    data.registration_closes_at = null;
  }
  return { ok: true, data };
}
