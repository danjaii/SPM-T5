// SCRUM-53: saving an event request as a draft (docs/specs/SCRUM-53-save-draft-event-request.md).
// A draft keeps whatever the organiser has filled in so far; the fields are nullable in the events table.

export const EVENT_DRAFT_FIELDS = [
  "name",
  "purpose",
  "description",
  "preferred_start_datetime",
  "preferred_end_datetime",
  "expected_attendance",
  "venue_requirements",
  "preferred_room_layout_id",
  "accessibility_requirements",
  "equipment_requirements_notes",
  "registration_required",
  "registration_capacity",
  "registration_opens_at",
  "registration_closes_at",
] as const;

export type EventDraftInput = Record<(typeof EVENT_DRAFT_FIELDS)[number], unknown>;

export type ParsedEventDraft = { ok: true; data: EventDraftInput } | { ok: false; fieldErrors: Record<string, string> };

/** SCRUM-53/AC1: pick the request's fields out of the body; anything not sent is null. */
export function parseEventRequestDraft(body: unknown): ParsedEventDraft {
  const source = (body ?? {}) as Record<string, unknown>;
  const data = {} as EventDraftInput;
  for (const field of EVENT_DRAFT_FIELDS) data[field] = source[field] ?? null;
  return { ok: true, data };
}
