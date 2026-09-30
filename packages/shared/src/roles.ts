export const ROLES = [
  "event_organiser",
  "event_coordinator",
  "venue_staff",
  "technical_support_staff",
  "attendee",
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function canReviewEvents(role: Role): boolean {
  return role === "event_coordinator";
}

/** SCRUM-29: the venue catalogue can only be seen by event coordinator and venue staff */
export function canViewVenueCatalogue(role: Role): boolean {
  return role === "event_coordinator" || role === "venue_staff";
}

/** SCRUM-49: only event organisers create event requests */
export function canCreateEventRequests(role: Role): boolean {
  return role === "event_organiser";
}
