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

/** SCRUM-29: the venue catalogue can only be seen by event coordinator and venue staff */
export function canViewVenueCatalogue(role: Role): boolean {
  return role === "event_coordinator" || role === "venue_staff";
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

/**
 * SCRUM-69: what each role is responsible for, as the profile page lists it for internal users. One entry per role, so a role
 * added to ROLES cannot be left out. The wording follows the Week 1 Customer Briefing (the "Main Responsibility" table and the
 * event planning process) and the week 7 customer changes. External roles have none to show.
 */
const RESPONSIBILITIES: Record<Role, readonly string[]> = {
  event_organiser: [],
  attendee: [],
  event_coordinator: [
    "Act as the main internal point of contact for the events assigned to them",
    "Review event requests, ask for clarification or amendments, and approve or reject them",
    "Search for venues and submit venue booking requests",
    "Monitor the outstanding arrangements and confirm the event",
    "Review the changes an Event Organiser requests",
  ],
  event_coordinator_lead: [
    "Oversee the incoming event requests waiting to be assigned",
    "Review basic event information and assign a suitable Event Coordinator",
    "Reassign events where necessary",
    "View all coordinator assignments and the active events under their supervision",
  ],
  venue_staff: [
    "Maintain the venue catalogue and the layouts each venue supports",
    "Mark venues unavailable (maintenance, renovation, safety or other operational reasons)",
    "Approve or reject venue booking requests, with a reason or an alternative",
    "Prepare venues for events",
  ],
  technical_support_staff: [
    "Maintain the equipment catalogue and its operational status",
    "Check whether enough suitable equipment is available for an event's date and time",
    "Reserve equipment for events",
    "Provide technical support for events, where assigned",
  ],
  safety_officer: [
    "Review the operational safety of planned events once the venue and technical arrangements are confirmed",
    "Consider attendance, venue capacity and layout, emergency access, accessibility, equipment placement, crowd movement and venue restrictions",
    "Approve the event, reject the safety arrangement, or request changes",
  ],
};

export function responsibilitiesFor(role: Role): readonly string[] {
  return RESPONSIBILITIES[role];
}
