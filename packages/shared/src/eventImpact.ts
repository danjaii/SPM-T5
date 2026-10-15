import type { CurrentEventDetails, EventDetailsChanges, EventDetailsField } from "./eventDetails";
import { EQUIPMENT_REQUEST_STATUS_LABELS, equipmentRequestStatusOf } from "./equipmentRequest";
import { dbStatusToApi, isHoldingDbStatus } from "./venueBooking";

// SCRUM-112 (docs/specs/important-change-impact.md): which of an event's venue bookings and equipment requests an important
// change may affect, and why. Shared so event-service and apps/web word the warning the same way.

/** One of the event's venue bookings, with its venue. `status` is the database value. */
export type ImpactVenueBooking = {
  id: string;
  venueName: string;
  venueCapacity: number;
  status: string;
  start: string;
  end: string;
  expectedAttendance: number | null;
};

/** One of the event's equipment requests. `status` is the database value. */
export type ImpactEquipmentRequest = {
  id: string;
  equipmentName: string;
  quantity: number;
  status: string;
  start: string;
  end: string;
};

export type AffectedArrangement = {
  kind: "venue_booking" | "equipment_request";
  id: string;
  name: string;
  quantity: number | null;
  start: string;
  end: string;
  statusLabel: string;
  reasons: string[];
};

export const IMPACT_REASON_TIME = "No longer within the event's new date and time.";
export const IMPACT_REASON_VENUE_REQUIREMENTS = "The event's venue requirements changed. Check this venue still suits them.";
export const IMPACT_REASON_EQUIPMENT_REQUIREMENTS =
  "The event's equipment requirements changed. Check this request still meets them.";

/** The fields that change what a venue must offer (112-S11). */
const VENUE_REQUIREMENT_FIELDS: EventDetailsField[] = [
  "preferred_room_layout_id",
  "accessibility_requirements",
  "venue_requirements",
];

/** Equipment requests still holding or asking for their equipment: Submitted, Under Review, Arranged (112-S3). */
const ACTIVE_EQUIPMENT_DB_STATUSES = ["requested", "under_review", "approved", "reserved"];

/** The event's value of a field after the change. */
function after<F extends keyof CurrentEventDetails>(changes: EventDetailsChanges, event: CurrentEventDetails, field: F) {
  return field in changes ? (changes[field]!.to as CurrentEventDetails[F]) : event[field];
}

/** Whether a period no longer sits inside the event's new start and end (AC3). */
function outsideNewTime(changes: EventDetailsChanges, event: CurrentEventDetails, start: string, end: string): boolean {
  if (!("preferred_start_datetime" in changes) && !("preferred_end_datetime" in changes)) return false;
  const newStart = after(changes, event, "preferred_start_datetime");
  const newEnd = after(changes, event, "preferred_end_datetime");
  if (!newStart || !newEnd) return false;
  return Date.parse(start) < Date.parse(newStart) || Date.parse(end) > Date.parse(newEnd);
}

/**
 * AC2: every venue booking is listed when the attendance goes up, all treated alike (no "main" venue): the coordinator
 * decides, helped by the venue booking's own number (SCRUM-98 lets a side room have one).
 */
function attendanceReason(booking: ImpactVenueBooking, newAttendance: number): string {
  const forNumber = booking.expectedAttendance === null ? "" : ` This venue booking is for ${booking.expectedAttendance}`;
  if (booking.venueCapacity < newAttendance) {
    return (
      `${booking.venueName} holds ${booking.venueCapacity} people, but the event now expects ${newAttendance}.` +
      (forNumber && `${forNumber}.`) +
      " The venue may no longer be suitable."
    );
  }
  return (
    `The event now expects ${newAttendance} people.` +
    (forNumber ? `${forNumber}, and ${booking.venueName}` : ` ${booking.venueName}`) +
    ` holds ${booking.venueCapacity}. Check it still suits.`
  );
}

function capitalise(word: string): string {
  return word.charAt(0) + word.slice(1).toLowerCase();
}

export function affectedArrangements(
  changes: EventDetailsChanges,
  event: CurrentEventDetails,
  venueBookings: ImpactVenueBooking[],
  equipmentRequests: ImpactEquipmentRequest[],
): AffectedArrangement[] {
  const affected: AffectedArrangement[] = [];
  const attendance = changes.expected_attendance;
  const venueRequirementsChanged = VENUE_REQUIREMENT_FIELDS.some((field) => field in changes);

  for (const booking of venueBookings) {
    if (!isHoldingDbStatus(booking.status)) continue;
    const reasons: string[] = [];
    if (outsideNewTime(changes, event, booking.start, booking.end)) reasons.push(IMPACT_REASON_TIME);
    if (attendance && Number(attendance.to) > Number(attendance.from ?? 0)) reasons.push(attendanceReason(booking, Number(attendance.to)));
    if (venueRequirementsChanged) reasons.push(IMPACT_REASON_VENUE_REQUIREMENTS);
    if (reasons.length === 0) continue;
    affected.push({
      kind: "venue_booking",
      id: booking.id,
      name: booking.venueName,
      quantity: null,
      start: booking.start,
      end: booking.end,
      statusLabel: capitalise(dbStatusToApi(booking.status)!),
      reasons,
    });
  }

  for (const request of equipmentRequests) {
    if (!ACTIVE_EQUIPMENT_DB_STATUSES.includes(request.status)) continue;
    const reasons: string[] = [];
    if (outsideNewTime(changes, event, request.start, request.end)) reasons.push(IMPACT_REASON_TIME);
    if ("equipment_requirements_notes" in changes) reasons.push(IMPACT_REASON_EQUIPMENT_REQUIREMENTS);
    if (reasons.length === 0) continue;
    affected.push({
      kind: "equipment_request",
      id: request.id,
      name: request.equipmentName,
      quantity: request.quantity,
      start: request.start,
      end: request.end,
      statusLabel: EQUIPMENT_REQUEST_STATUS_LABELS[equipmentRequestStatusOf(request.status)!],
      reasons,
    });
  }

  return affected;
}
