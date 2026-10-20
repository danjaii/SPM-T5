export const ROLES = [
  "event_organiser",
  "event_coordinator",
  "venue_staff",
  "technical_support_staff",
  "attendee",
  // Week 7 customer changes: two new internal roles (docs/specs/user-profile.md, SCRUM-69)
  "event_coordinator_lead",
  "safety_officer",
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function canReviewEvents(role: Role): boolean {
  return role === "event_coordinator";
}

/** SCRUM-75/AC1 + AC7: the Event Coordinator Lead is its own role; only it may use the Lead pages and actions. */
export function isLead(role: unknown): boolean {
  return role === "event_coordinator_lead";
}

/** SCRUM-116/AC1 + AC2: only the Safety Officer may approve, reject or request changes in a safety check. */
export function canMakeSafetyDecision(role: Role): boolean {
  return role === "safety_officer";
}

/** SCRUM-29: the venue catalogue can only be seen by event coordinator and venue staff */
export function canViewVenueCatalogue(role: Role): boolean {
  return role === "event_coordinator" || role === "venue_staff";
}

/** SCRUM-49: only event organisers create event requests */
export function canCreateEventRequests(role: Role): boolean {
  return role === "event_organiser";
}

/** SCRUM-69: the staff who work inside ConnectSphere (the roles marked Internal in CLAUDE.md). The rest are external. */
const INTERNAL_ROLES: readonly Role[] = [
  "event_coordinator",
  "event_coordinator_lead",
  "venue_staff",
  "technical_support_staff",
  "safety_officer",
];

export function isInternalRole(role: Role): boolean {
  return INTERNAL_ROLES.includes(role);
}
