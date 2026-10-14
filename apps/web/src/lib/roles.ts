import type { Role } from "@spm-t5/shared";

// Order and wording follow the sign-in mockup; the remaining roles follow the same pattern.
export const ROLE_OPTIONS: { value: Role; label: string; description: string }[] = [
  { value: "event_coordinator", label: "Event Coordinator", description: "Internal · plan events, request venues, track readiness" },
  { value: "venue_staff", label: "Venue Staff", description: "Internal · approve or decline booking requests" },
  { value: "event_organiser", label: "Event Organiser", description: "External client · submit requests, follow status" },
  { value: "technical_support_staff", label: "Technical Support Staff", description: "Internal · manage equipment and technical needs" },
  { value: "attendee", label: "Attendee", description: "External · browse events, register and view tickets" },
  // SCRUM-75/AC3: the Lead signs in on the same page, choosing their role like everyone else
  { value: "event_coordinator_lead", label: "Event Coordinator Lead", description: "Internal · assign event requests to coordinators" },
];

export const roleLabel = (role: string) => ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;
