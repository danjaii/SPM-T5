import type { StatusTone } from "./status";
import type { UpcomingEvent } from "./getUpcomingEvents";

/** SCRUM-71/AC7: the label a card shows for each availability event-service can send ("open" has none). Shared by the card and the search. */
export const AVAILABILITY_LABELS: Record<UpcomingEvent["availability"], string | null> = {
  cancelled: "Cancelled",
  full: "Event Full",
  closed: "Registration Closed",
  open: null,
};

// SCRUM-139/AC7: how each availability label looks (never colour alone: StatusBadge adds the icon)
export const AVAILABILITY_TONES: Record<UpcomingEvent["availability"], StatusTone> = {
  cancelled: "neutral",
  full: "warning",
  closed: "neutral",
  open: "neutral",
};

// SCRUM-9/AC2: the places left, in words ("12 slots left", "1 slot left", "No slots left"); an event with no capacity has "No limit"
export const slotsText = (slots: number | null) =>
  slots === null ? "No limit" : slots === 0 ? "No slots left" : `${slots} ${slots === 1 ? "slot" : "slots"} left`;
