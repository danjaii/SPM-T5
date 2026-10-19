import {
  affectedArrangements,
  type AffectedArrangement,
  type CurrentEventDetails,
  type EventDetailsChanges,
  type ImpactEquipmentRequest,
  type ImpactVenueBooking,
} from "@spm-t5/shared";
import type { SupabaseDeps } from "../supabase";

type VenueBookingRow = {
  id: string;
  status: string;
  event_start_datetime: string;
  event_end_datetime: string;
  snapshot_expected_attendance: number | null;
  venue: { name: string; max_capacity: number } | null;
};

type EquipmentRequestRow = {
  id: string;
  status: string;
  quantity_requested: number;
  start_datetime: string;
  end_datetime: string;
  equipment: { name: string } | null;
};

/**
 * SCRUM-112: the event's venue bookings and equipment requests that an important change affects, read as the coordinator.
 * Null if they could not be read, so a change is never saved without the coordinator having seen them. Used by the edit
 * (SCRUM-111) and by approving a change request (SCRUM-67), which both send the same list back for review (SCRUM-113).
 */
export async function readAffectedArrangements(
  deps: SupabaseDeps,
  token: string,
  event: CurrentEventDetails & { id: string },
  changes: EventDetailsChanges,
): Promise<AffectedArrangement[] | null> {
  const db = deps.forUser(token);
  // "!venue_id": venue_bookings also links to venues through suggested_venue_id (SCRUM-40), so name the booked one
  const bookings = await db
    .from("venue_bookings")
    .select("id, status, event_start_datetime, event_end_datetime, snapshot_expected_attendance, venue:venues!venue_id(name, max_capacity)")
    .eq("event_id", event.id);
  const requests = await db
    .from("equipment_reservations")
    .select("id, status, quantity_requested, start_datetime, end_datetime, equipment:equipment(name)")
    .eq("event_id", event.id);
  if (bookings.error || requests.error) {
    console.error("reading the event's arrangements failed:", (bookings.error ?? requests.error)!.message);
    return null;
  }
  const venueBookings: ImpactVenueBooking[] = ((bookings.data ?? []) as unknown as VenueBookingRow[]).map((b) => ({
    id: b.id,
    venueName: b.venue?.name ?? "Venue",
    venueCapacity: b.venue?.max_capacity ?? 0,
    status: b.status,
    start: b.event_start_datetime,
    end: b.event_end_datetime,
    expectedAttendance: b.snapshot_expected_attendance,
  }));
  const equipmentRequests: ImpactEquipmentRequest[] = ((requests.data ?? []) as unknown as EquipmentRequestRow[]).map((r) => ({
    id: r.id,
    equipmentName: r.equipment?.name ?? "Equipment",
    quantity: r.quantity_requested,
    status: r.status,
    start: r.start_datetime,
    end: r.end_datetime,
  }));
  return affectedArrangements(changes, event, venueBookings, equipmentRequests);
}

/** SCRUM-113: the list as update_event_details() takes it to send them back for review. */
export function sendBackOf(affected: AffectedArrangement[]) {
  return {
    venue_bookings: affected.filter((a) => a.kind === "venue_booking").map((a) => a.id),
    equipment_requests: affected.filter((a) => a.kind === "equipment_request").map((a) => a.id),
  };
}
