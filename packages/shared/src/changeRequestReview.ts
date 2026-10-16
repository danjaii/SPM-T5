import {
  EVENT_FIELD_LABELS,
  EVENT_IMPORTANT_FIELDS,
  EVENT_ORDINARY_FIELDS,
  type CurrentEventDetails,
  type EventDetailsChanges,
  type EventDetailsField,
} from "./eventDetails";

// SCRUM-67 (docs/specs/review-change-request.md): a change request (SCRUM-66) read against the event as it is now, so the
// coordinator sees each requested change with the current value, and approving saves exactly the request through
// SCRUM-111's update_event_details().

export const CHANGE_REQUEST_REASON_MAX = 2000;

export const CHANGE_REQUEST_REVIEW_MESSAGES = {
  reasonMissing: "Give a reason for rejecting this request.",
  reasonTooLong: `Keep the reason to ${CHANGE_REQUEST_REASON_MAX} characters or fewer.`,
  outdated: "The event has changed since this request was made, so it can't be applied as it stands. Reject it with a reason.",
  unsupported: "This request includes a change the system can't apply. Reject it with a reason.",
  alreadyReviewed: "This change request has already been reviewed.",
  awaitingReview: "A change request is awaiting your review.",
} as const;

/** One requested change as the coordinator reviews it. */
export interface ChangeRequestRow {
  field: string;
  label: string;
  /** The event's value now. */
  current: unknown;
  requested: unknown;
  /** The event's value is no longer the one the request was made against. */
  changedSince: boolean;
  /** Whether approving can apply it (one of SCRUM-111's editable fields). */
  supported: boolean;
}

export interface ReadChangeRequest {
  /** In the edit form's order, then any field the system cannot apply. */
  rows: ChangeRequestRow[];
  /** What approving saves, as update_event_details() takes it: the supported fields, each { from, to }. */
  changes: EventDetailsChanges;
  /** A field changed since the request (AC3: approval is refused). */
  outdated: boolean;
  /** Fields the system cannot apply (approval is refused). */
  unsupported: string[];
}

const EDITABLE: readonly string[] = [...EVENT_ORDINARY_FIELDS, ...EVENT_IMPORTANT_FIELDS];
const TIMES = new Set(["preferred_start_datetime", "preferred_end_datetime"]);

/** "registration_capacity" -> "Registration capacity" */
const readable = (field: string) => {
  const words = field.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Whether two values of a field are the same: times as instants, empty text as none. */
function same(field: string, a: unknown, b: unknown): boolean {
  const none = (v: unknown) => v === null || v === undefined || v === "";
  if (none(a) || none(b)) return none(a) && none(b);
  if (TIMES.has(field)) return Date.parse(String(a)) === Date.parse(String(b));
  return String(a) === String(b);
}

/**
 * AC2, AC3: a request made in the app holds { from, to } per field; a seeded one holds only the new value, which is read as a
 * change from the event's current value.
 */
export function readChangeRequest(proposed: unknown, event: CurrentEventDetails): ReadChangeRequest {
  const read: ReadChangeRequest = { rows: [], changes: {}, outdated: false, unsupported: [] };
  if (!proposed || typeof proposed !== "object" || Array.isArray(proposed)) return read;
  const entries = proposed as Record<string, unknown>;
  const current = event as unknown as Record<string, unknown>;

  const order = (field: string) => (EDITABLE.includes(field) ? EDITABLE.indexOf(field) : EDITABLE.length);
  for (const field of Object.keys(entries).sort((a, b) => order(a) - order(b))) {
    const entry = entries[field];
    const pair = entry !== null && typeof entry === "object" && "to" in entry ? (entry as { from?: unknown; to: unknown }) : null;
    const now = current[field] ?? null;
    const from = pair && "from" in pair ? pair.from : now;
    const requested = pair ? pair.to : entry;
    const supported = EDITABLE.includes(field);
    const changedSince = supported && !same(field, from, now);

    read.rows.push({
      field,
      label: supported ? EVENT_FIELD_LABELS[field as EventDetailsField] : readable(field),
      current: now,
      requested,
      changedSince,
      supported,
    });
    if (!supported) read.unsupported.push(field);
    else read.changes[field as EventDetailsField] = { from, to: requested };
    if (changedSince) read.outdated = true;
  }
  return read;
}

/** AC4: rejecting needs a reason, which the organiser sees. */
export function parseChangeRequestRejection(body: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  const raw = (body as { reason?: unknown } | null | undefined)?.reason;
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (!reason) return { ok: false, error: CHANGE_REQUEST_REVIEW_MESSAGES.reasonMissing };
  if (reason.length > CHANGE_REQUEST_REASON_MAX) return { ok: false, error: CHANGE_REQUEST_REVIEW_MESSAGES.reasonTooLong };
  return { ok: true, reason };
}
