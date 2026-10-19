// Must match the event_status enum in supabase/migrations/01_schema.sql.
export const EVENT_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "returned",
  "approved",
  "planning",
  "awaiting_arrangements",
  "confirmed",
  "completed",
  "cancelled",
  "rejected",
] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

export function isEventStatus(value: unknown): value is EventStatus {
  return typeof value === "string" && (EVENT_STATUSES as readonly string[]).includes(value);
}

// SCRUM-24: a coordinator can approve or reject a request only while it is awaiting a decision.
export const DECIDABLE_EVENT_STATUSES = ["submitted", "under_review"] as const satisfies readonly EventStatus[];

export function canDecideEvent(status: string): boolean {
  return (DECIDABLE_EVENT_STATUSES as readonly string[]).includes(status);
}

// SCRUM-45/AC3: review can only begin on a request that has been submitted and not yet picked up.
export function canStartReview(status: string): boolean {
  return status === "submitted";
}

// SCRUM-77 (docs/specs/event-coordinator-lead-role.md, "Closed event"): the final statuses, agreed with the PO. Every
// other status, including draft and returned, is non-closed. The one definition for app code and tests; the database's
// is_closed_event_status() (migration 21) must match it, which tests/integration/leadQueue.test.ts checks.
export const CLOSED_EVENT_STATUSES = ["completed", "cancelled", "rejected"] as const satisfies readonly EventStatus[];

export function isClosedEventStatus(status: string): boolean {
  return (CLOSED_EVENT_STATUSES as readonly string[]).includes(status);
}
