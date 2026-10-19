import type { UpcomingEvent } from "./getUpcomingEvents";

/** SCRUM-71/AC7: the label a card shows for each availability event-service can send ("open" has none). Shared by the card and the search. */
export const AVAILABILITY_LABELS: Record<UpcomingEvent["availability"], string | null> = {
  cancelled: "Cancelled",
  full: "Event Full",
  closed: "Registration Closed",
  open: null,
};
