export type Role =
  | "event_organiser"
  | "event_coordinator"
  | "venue_staff"
  | "technical_support_staff"
  | "attendee";

export function canReviewEvents(role: Role): boolean {
  return role === "event_coordinator";
}
