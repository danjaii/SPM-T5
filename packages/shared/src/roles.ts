export type Role =
  | "event_organiser"
  | "event_coordinator"
  | "venue_staff"
  | "technical_support"
  | "attendee";

export function canReviewEvents(role: Role): boolean {
  return role === "event_coordinator";
}
