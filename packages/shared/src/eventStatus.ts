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
