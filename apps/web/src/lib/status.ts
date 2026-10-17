import {
  EQUIPMENT_REQUEST_STATUSES,
  EQUIPMENT_REQUEST_STATUS_LABELS,
  EVENT_STATUSES,
  VENUE_BOOKING_STATUSES,
  type EquipmentRequestStatus,
  type EventStatus,
  type VenueBookingStatus,
} from "@spm-t5/shared";

// SCRUM-120/AC2: the one place that decides how a status looks. Every event, venue booking and equipment request status maps
// to a tone, an icon and a label; StatusBadge renders them. A status never uses the primary (button) colour, and the icon
// and label mean it is never colour alone. Adding a status to a shared list fails typecheck until it is mapped here.

export type StatusTone = "neutral" | "info" | "warning" | "success" | "danger";
export type StatusIconName = "circle" | "info" | "alert" | "check" | "x" | "pause" | "timer-off";

export interface StatusDisplay {
  tone: StatusTone;
  icon: StatusIconName;
  label: string;
}

export const TONE_ICONS: Record<StatusTone, StatusIconName> = {
  neutral: "circle",
  info: "info",
  warning: "alert",
  success: "check",
  danger: "x",
};

const display = (tone: StatusTone, label: string, icon: StatusIconName = TONE_ICONS[tone]): StatusDisplay => ({ tone, icon, label });

export const EVENT_STATUS_DISPLAY: Record<EventStatus, StatusDisplay> = {
  draft: display("neutral", "Draft"),
  submitted: display("info", "Submitted"),
  under_review: display("info", "Under Review"),
  returned: display("warning", "Returned"),
  approved: display("success", "Approved"),
  planning: display("info", "Planning"),
  awaiting_arrangements: display("info", "Awaiting Arrangements"),
  confirmed: display("success", "Confirmed"),
  completed: display("success", "Completed"),
  cancelled: display("neutral", "Cancelled"),
  rejected: display("danger", "Rejected"),
};

/** The venue booking statuses plus the two a hold can reach (Hold while it is kept for the coordinator, Expired once it lapses). */
export type BookingStatusKey = VenueBookingStatus | "HOLD" | "EXPIRED";

export const BOOKING_STATUS_DISPLAY: Record<BookingStatusKey, StatusDisplay> = {
  PENDING: display("info", "Pending"),
  APPROVED: display("success", "Approved"),
  REJECTED: display("danger", "Rejected"),
  WITHDRAWN: display("neutral", "Withdrawn"),
  CANCELLED: display("neutral", "Cancelled"),
  HOLD: display("info", "Hold", "pause"),
  EXPIRED: display("danger", "Expired", "timer-off"),
};

export const EQUIPMENT_STATUS_DISPLAY: Record<EquipmentRequestStatus, StatusDisplay> = {
  SUBMITTED: display("info", EQUIPMENT_REQUEST_STATUS_LABELS.SUBMITTED),
  UNDER_REVIEW: display("info", EQUIPMENT_REQUEST_STATUS_LABELS.UNDER_REVIEW),
  ARRANGED: display("success", EQUIPMENT_REQUEST_STATUS_LABELS.ARRANGED),
  CANNOT_FULFIL: display("danger", EQUIPMENT_REQUEST_STATUS_LABELS.CANNOT_FULFIL),
  RELEASED: display("neutral", EQUIPMENT_REQUEST_STATUS_LABELS.RELEASED),
};

export const ALL_STATUS_DISPLAYS: { group: string; key: string; display: StatusDisplay }[] = [
  ...EVENT_STATUSES.map((key) => ({ group: "Event", key, display: EVENT_STATUS_DISPLAY[key] })),
  ...[...VENUE_BOOKING_STATUSES, "HOLD" as const, "EXPIRED" as const].map((key) => ({ group: "Venue booking", key, display: BOOKING_STATUS_DISPLAY[key] })),
  ...EQUIPMENT_REQUEST_STATUSES.map((key) => ({ group: "Equipment request", key, display: EQUIPMENT_STATUS_DISPLAY[key] })),
];

/** A neutral fallback for a status string this code does not know, so the page still shows it with an icon and label. */
export function unknownStatusDisplay(status: string): StatusDisplay {
  return display("neutral", status);
}
