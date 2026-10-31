// SCRUM-46: in-app notifications, shared by notification-service (which builds them) and apps/web (which shows them).

/**
 * The known notification types. The first four are in supabase/seed.sql; `venue_booking_flagged` is written by
 * SCRUM-106. The column stays free text, so an unknown type is still shown, just without special treatment.
 */
export const NOTIFICATION_TYPES = [
  "event_submitted",
  "coordinator_assigned",
  "event_confirmed",
  "registration_opened",
  "venue_booking_flagged",
  // SCRUM-20: on-site technical support assignments (migration 41)
  "technical_assignment_assigned",
  "technical_assignment_changed",
  "technical_assignment_cancelled",
  // SCRUM-47: event request decisions, comments and safety decisions (migration 44)
  "event_approved",
  "event_rejected",
  "comment_mention",
  "comment_reply",
  "safety_approved",
  "safety_rejected",
  "safety_changes_requested",
  "clarification_requested",
  "clarification_answered",
  // SCRUM-126: the coordinator an event was taken from (migration 50)
  "coordinator_reassigned",
  // SCRUM-172: venue decisions, important changes, registrations, cancellations and replacements (migration 65), which also
  // writes event_submitted and event_confirmed
  "venue_booking_approved",
  "venue_booking_rejected",
  "event_changed",
  "registration_status_changed",
  "event_cancelled",
  "venue_replaced",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** What a notification points at: an event, or a venue booking request (migration 35). */
export type NotificationTargetKind = "event" | "venue_booking";

/** AC7: shown instead of a name when the caller can no longer see what the notification points at. */
export const NO_ACCESS_LABEL = "You no longer have access to this item";

export interface NotificationRelated {
  kind: NotificationTargetKind;
  id: string;
  /** The item's name, or NO_ACCESS_LABEL when the caller cannot see it. */
  label: string;
  /** The page to open, or null when the caller cannot see the item (AC7). */
  href: string | null;
}

/** One notification as notification-service returns it and the notification page shows it (AC2). */
export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  /** ISO timestamp of when it was generated. */
  createdAt: string;
  /** ISO timestamp of when it was first read; null while unread. */
  readAt: string | null;
  related: NotificationRelated | null;
  /** SCRUM-47/AC11: whether the reader needs to do something (notificationRequiresAction). */
  actionRequired: boolean;
  /**
   * SCRUM-20/AC4: only on an on-site assignment notification that can be acknowledged ("assigned" or "changed"):
   * whether it can still be acknowledged, and when it was. Absent on every other notification.
   */
  acknowledgement?: NotificationAcknowledgement;
}

/** SCRUM-20: an assignment notification can be acknowledged only while it is about the assignment's current details. */
export interface NotificationAcknowledgement {
  canAcknowledge: boolean;
  /** ISO timestamp of when the technician acknowledged these details; null while not acknowledged. */
  acknowledgedAt: string | null;
}

/**
 * AC5: where a notification's target opens for this role. Venue staff review bookings in the queue; everyone else
 * uses the booking page. (Whether they may open it is decided by row level security, not here.)
 */
export function notificationHref(kind: NotificationTargetKind, id: string, role?: string): string {
  // SCRUM-172: the event page refuses attendees (GET /events/:id), so their event notifications open My registrations
  if (kind === "event") return role === "attendee" ? "/registrations" : `/events/${id}`;
  return role === "venue_staff" ? `/booking-queue/${id}` : `/venue-bookings/${id}`;
}

/** SCRUM-47/AC11: the types that ask the reader to do something; every other type, known or not, is for information. */
const ACTION_REQUIRED_TYPES: ReadonlySet<string> = new Set([
  "coordinator_assigned",
  "comment_mention",
  "safety_changes_requested", // AC12
  "clarification_requested", // AC2: the organiser answers
  "clarification_answered", // AC3: the coordinator reads the answer
  "event_submitted", // SCRUM-172/AC1: a Lead assigns a coordinator
  "venue_booking_rejected", // SCRUM-172/AC2: the coordinator finds another venue
]);

/** SCRUM-47/AC11: whether a notification needs the reader to act, shown as "Action needed". */
export function notificationRequiresAction(type: string): boolean {
  return ACTION_REQUIRED_TYPES.has(type);
}

export const NOTIFICATION_DEFAULT_LIMIT = 50;
export const NOTIFICATION_MAX_LIMIT = 100;

/** A `?limit=` value: a whole number from 1 to 100, else the default of 50. */
export function parseNotificationLimit(raw: unknown): number {
  const n = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1) return NOTIFICATION_DEFAULT_LIMIT;
  return Math.min(n, NOTIFICATION_MAX_LIMIT);
}
