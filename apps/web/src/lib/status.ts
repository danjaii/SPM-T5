import {
  EQUIPMENT_REQUEST_STATUSES,
  EQUIPMENT_REQUEST_STATUS_LABELS,
  EVENT_STATUSES,
  VENUE_BOOKING_STATUSES,
  type VenueBookingFlagKind,
  type EquipmentRequestStatus,
  type EventStatus,
  type RegistrationStatus,
  type VenueBookingStatus,
} from "@spm-t5/shared";
import type { OutOfServiceReason } from "./equipmentRequests";
import { STATUS_LABELS as REGISTRATION_STATUS_LABELS } from "./eventRegistration";

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
  REPLACED: display("neutral", "Replaced"),
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

/** SCRUM-139/AC2, AC7: an attendee's registration. Only Confirmed holds a place; Withdrawn is neutral, Rejected danger. */
export const REGISTRATION_STATUS_DISPLAY: Record<RegistrationStatus, StatusDisplay> = {
  pending: display("info", REGISTRATION_STATUS_LABELS.pending),
  confirmed: display("success", REGISTRATION_STATUS_LABELS.confirmed),
  rejected: display("danger", REGISTRATION_STATUS_LABELS.rejected),
  withdrawn: display("neutral", REGISTRATION_STATUS_LABELS.withdrawn),
};

export const ALL_STATUS_DISPLAYS: { group: string; key: string; display: StatusDisplay }[] = [
  ...EVENT_STATUSES.map((key) => ({ group: "Event", key, display: EVENT_STATUS_DISPLAY[key] })),
  ...[...VENUE_BOOKING_STATUSES, "HOLD" as const, "EXPIRED" as const].map((key) => ({ group: "Venue booking", key, display: BOOKING_STATUS_DISPLAY[key] })),
  ...EQUIPMENT_REQUEST_STATUSES.map((key) => ({ group: "Equipment request", key, display: EQUIPMENT_STATUS_DISPLAY[key] })),
  ...(Object.keys(REGISTRATION_STATUS_DISPLAY) as RegistrationStatus[]).map((key) => ({ group: "Registration", key, display: REGISTRATION_STATUS_DISPLAY[key] })),
];

/** A neutral fallback for a status string this code does not know, so the page still shows it with an icon and label. */
export function unknownStatusDisplay(status: string): StatusDisplay {
  return display("neutral", status);
}

/**
 * SCRUM-137/AC1: whether enough units are free, as the mock-up's labels. Any shortfall is a fail, so both short states
 * use the cross icon: Partial (some free) keeps the mock-up's amber, Unavailable (none free) is danger.
 */
export function availabilityDisplay(available: number, needed: number): StatusDisplay {
  if (available >= needed) return display("success", "Enough");
  if (available > 0) return display("warning", "Partial", "x");
  return display("danger", "Unavailable");
}

/** SCRUM-137/AC2: why none of an item can be used. */
export const OUT_OF_SERVICE_DISPLAY: Record<OutOfServiceReason, StatusDisplay> = {
  damaged: display("danger", "Damaged", "x"),
  under_maintenance: display("warning", "Under maintenance", "pause"),
  retired: display("neutral", "Retired", "timer-off"),
};

/** SCRUM-137/AC2: units held by other events during the period. */
export const RESERVED_DISPLAY: StatusDisplay = display("info", "Reserved", "pause");

/** SCRUM-135/AC1: how a booking flag looks. A clash with another booking is a Conflict (danger); a blocked venue is Venue unavailable (warning). */
export const FLAG_DISPLAY: Record<VenueBookingFlagKind, StatusDisplay> = {
  buffer_conflict: display("danger", "Conflict", "alert"),
  venue_unavailable: display("warning", "Venue unavailable", "timer-off"),
};
