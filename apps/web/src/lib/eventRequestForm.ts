import { parseEventRequest, sgtToUtc, utcToSgt } from "@spm-t5/shared";

// SCRUM-123: the six steps of the new event request form, and how the form's boxes become the request that
// event-service (SCRUM-49) validates. Validation is the shared parseEventRequest, so the form and the API agree.

export const STEPS = [
  { key: "basics", label: "Basics", hint: "Name, purpose, description" },
  { key: "schedule", label: "Date & attendance", hint: "When and how many" },
  { key: "venue", label: "Venue needs", hint: "Layout, accessibility" },
  { key: "equipment", label: "Equipment", hint: "AV, furniture, technical needs" },
  { key: "registration", label: "Registration", hint: "Who can sign up, and how many" },
  { key: "review", label: "Review & submit", hint: "Check everything, then send" },
] as const;

export const REVIEW_STEP = STEPS.length - 1;

/** The request fields each step collects, so a step only shows (and is blocked by) its own errors. */
const STEP_FIELDS: readonly (readonly string[])[] = [
  ["name", "purpose", "description"],
  ["preferred_start_datetime", "preferred_end_datetime", "expected_attendance"],
  ["venue_requirements", "preferred_room_layout_id", "accessibility_requirements"],
  ["equipment_requirements_notes"],
  ["registration_required", "registration_capacity", "registration_opens_at", "registration_closes_at"],
  [],
];

export const ACCESSIBILITY_OPTIONS = [
  "Wheelchair access",
  "Hearing loop",
  "Accessible toilets",
  "Step-free stage",
  "Quiet room",
  "Reserved seating",
] as const;

export interface EventRequestFormValues {
  name: string;
  purpose: string;
  description: string;
  /** "YYYY-MM-DDTHH:mm" from a datetime-local box, in Singapore time. */
  start: string;
  end: string;
  attendance: string;
  venueRequirements: string;
  layoutId: string;
  accessibility: string[];
  accessibilityNotes: string;
  equipment: string;
  /** "" until the organiser answers. */
  registrationRequired: "" | "yes" | "no";
  registrationCapacity: string;
  registrationOpens: string;
  registrationCloses: string;
}

export const EMPTY_VALUES: EventRequestFormValues = {
  name: "",
  purpose: "",
  description: "",
  start: "",
  end: "",
  attendance: "",
  venueRequirements: "",
  layoutId: "",
  accessibility: [],
  accessibilityNotes: "",
  equipment: "",
  registrationRequired: "",
  registrationCapacity: "",
  registrationOpens: "",
  registrationCloses: "",
};

/** A datetime-local value in Singapore time -> an ISO instant, or undefined when it is empty or not a date. */
function instant(local: string): string | undefined {
  const [date, time] = local.split("T");
  if (!date || !time) return undefined;
  const at = sgtToUtc(date, time.slice(0, 5));
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

/** A whole number from a box, undefined when empty, NaN-safe so the shared rule reports it. */
function count(text: string): number | undefined {
  const t = text.trim();
  return t === "" ? undefined : Number(t);
}

/** Accessibility is the ticked needs plus any note; nothing at all is the valid answer "None required". */
export function accessibilityText(values: Pick<EventRequestFormValues, "accessibility" | "accessibilityNotes">): string {
  const parts = [...values.accessibility, values.accessibilityNotes.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "None required";
}

/** The body event-service's POST /events takes. Empty boxes are left out, so the shared rules name them. */
export function toRequestBody(v: EventRequestFormValues): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: v.name,
    purpose: v.purpose,
    description: v.description,
    preferred_start_datetime: instant(v.start),
    preferred_end_datetime: instant(v.end),
    expected_attendance: count(v.attendance),
    venue_requirements: v.venueRequirements,
    preferred_room_layout_id: v.layoutId || undefined,
    accessibility_requirements: accessibilityText(v),
    equipment_requirements_notes: v.equipment,
    registration_required: v.registrationRequired === "" ? undefined : v.registrationRequired === "yes",
  };
  if (v.registrationRequired === "yes") {
    body.registration_capacity = count(v.registrationCapacity);
    body.registration_opens_at = instant(v.registrationOpens);
    body.registration_closes_at = instant(v.registrationCloses);
  }
  return body;
}

/** SCRUM-53/AC1: the body POST /events/drafts takes. Whatever is still empty is left out, including the "None required" answer. */
export function toDraftBody(v: EventRequestFormValues): Record<string, unknown> {
  const body = toRequestBody(v);
  if (v.accessibility.length === 0 && v.accessibilityNotes.trim() === "") delete body.accessibility_requirements;
  for (const [field, value] of Object.entries(body)) {
    if (value === undefined || (typeof value === "string" && value.trim() === "")) delete body[field];
  }
  return body;
}

/** Every error in the whole request, keyed by request field. */
export function validateRequest(v: EventRequestFormValues, now: Date = new Date()): Record<string, string> {
  const parsed = parseEventRequest(toRequestBody(v), now);
  return parsed.ok ? {} : parsed.fieldErrors;
}

/** SCRUM-123/AC2: only the errors of the fields on this step, so a later empty step does not block an earlier one. */
export function validateStep(step: number, v: EventRequestFormValues, now: Date = new Date()): Record<string, string> {
  const all = validateRequest(v, now);
  return Object.fromEntries(STEP_FIELDS[step].filter((field) => field in all).map((field) => [field, all[field]]));
}

/** The first step that has an error, so Submit can send the organiser back to it. */
export function firstStepWithError(errors: Record<string, string>): number {
  const found = STEP_FIELDS.findIndex((fields) => fields.some((field) => field in errors));
  return found === -1 ? REVIEW_STEP : found;
}

/** SCRUM-123/AC3: the Review step's sections, each with the step its Edit link goes back to. */
export interface ReviewSection {
  step: number;
  title: string;
  rows: { label: string; value: string }[];
}

const YES_NO = { yes: "Attendee registration needed", no: "No attendee registration" } as const;

export function reviewSections(v: EventRequestFormValues, layoutName: (id: string) => string | undefined): ReviewSection[] {
  const show = (text: string) => (text.trim() === "" ? "Not provided" : text.trim());
  const when = (local: string) => (local ? local.replace("T", " ") + " (Singapore time)" : "Not provided");
  return [
    {
      step: 0,
      title: "Basics",
      rows: [
        { label: "Event name", value: show(v.name) },
        { label: "Purpose", value: show(v.purpose) },
        { label: "Description", value: show(v.description) },
      ],
    },
    {
      step: 1,
      title: "Date and attendance",
      rows: [
        { label: "Starts", value: when(v.start) },
        { label: "Ends", value: when(v.end) },
        { label: "Expected attendance", value: show(v.attendance) },
      ],
    },
    {
      step: 2,
      title: "Venue needs",
      rows: [
        { label: "Venue requirements", value: show(v.venueRequirements) },
        { label: "Room layout", value: layoutName(v.layoutId) ?? "Not provided" },
        { label: "Accessibility needs", value: accessibilityText(v) },
      ],
    },
    { step: 3, title: "Equipment", rows: [{ label: "Equipment requirements", value: show(v.equipment) }] },
    {
      step: 4,
      title: "Registration",
      rows: [
        { label: "Registration", value: v.registrationRequired === "" ? "Not provided" : YES_NO[v.registrationRequired] },
        ...(v.registrationRequired === "yes"
          ? [
              { label: "Capacity", value: show(v.registrationCapacity) },
              { label: "Opens", value: when(v.registrationOpens) },
              { label: "Closes", value: when(v.registrationCloses) },
            ]
          : []),
      ],
    },
  ];
}

/** SCRUM-54/AC1: an events row as GET /events/drafts/:id sends it; only the fields the form has are read. */
export interface StoredDraft {
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
  registration_required: boolean | null;
  registration_capacity: number | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
}

/** An ISO instant -> a datetime-local value in Singapore time, "" when empty. */
function local(iso: string | null): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const { date, time } = utcToSgt(at);
  return `${date}T${time}`;
}

/** The ticked needs come first in the stored text (see accessibilityText); whatever follows them is the note. */
function splitAccessibility(text: string | null): Pick<EventRequestFormValues, "accessibility" | "accessibilityNotes"> {
  if (!text || text === "None required") return { accessibility: [], accessibilityNotes: "" };
  const parts = text.split(", ");
  const accessibility: string[] = [];
  while (parts.length > 0 && (ACCESSIBILITY_OPTIONS as readonly string[]).includes(parts[0])) accessibility.push(parts.shift() as string);
  return { accessibility, accessibilityNotes: parts.join(", ") };
}

/**
 * SCRUM-54/AC1: the form's boxes for a saved draft. Nothing is invented: an empty column is an empty box, the placeholder name
 * "Untitled draft" is not shown as if the organiser typed it, and registration is "yes" only when it was saved as needed (a
 * draft cannot tell "no" from "not answered yet", so the organiser answers it again rather than submitting a guess).
 */
export function draftToValues(d: StoredDraft): EventRequestFormValues {
  return {
    name: d.name && d.name !== "Untitled draft" ? d.name : "",
    purpose: d.purpose ?? "",
    description: d.description ?? "",
    start: local(d.preferred_start_datetime),
    end: local(d.preferred_end_datetime),
    attendance: d.expected_attendance === null || d.expected_attendance === undefined ? "" : String(d.expected_attendance),
    venueRequirements: d.venue_requirements ?? "",
    layoutId: d.preferred_room_layout_id ?? "",
    ...splitAccessibility(d.accessibility_requirements),
    equipment: d.equipment_requirements_notes ?? "",
    registrationRequired: d.registration_required ? "yes" : "",
    registrationCapacity: d.registration_capacity === null || d.registration_capacity === undefined ? "" : String(d.registration_capacity),
    registrationOpens: local(d.registration_opens_at),
    registrationCloses: local(d.registration_closes_at),
  };
}
