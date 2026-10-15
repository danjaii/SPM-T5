import type { SupabaseClient } from "@supabase/supabase-js";

/** SCRUM-86/AC2: one of an event's equipment requests (a row of equipment_reservations), with the names to show. */
export interface EquipmentRequestInfo {
  id: string;
  eventId: string;
  equipmentName: string;
  equipmentType: string | null;
  quantity: number;
  /** The booked venue, or null for a row made before requests named one. */
  venueName: string | null;
  notes: string | null;
  /** The DB equipment_reservation_status; equipmentRequestStatusOf() turns it into what the user sees. */
  status: string;
  /** SCRUM-102 (102-S31): why its venue booking was cancelled, which released this equipment; null otherwise. */
  venueBookingCancellationReason: string | null;
  createdAt: Date;
}

export interface EquipmentRequestReader {
  /** Every row for the event, oldest first. */
  forEvent(eventId: string): Promise<EquipmentRequestInfo[]>;
}

type Row = Record<string, unknown>;

const toRequest = (r: Row): EquipmentRequestInfo => {
  const equipment = r.equipment as Row | null;
  const booking = r.booking as Row | null;
  const venue = booking?.venue as Row | null | undefined;
  return {
    id: r.id as string,
    eventId: r.event_id as string,
    equipmentName: (equipment?.name as string | undefined) ?? "Unknown equipment",
    equipmentType: (equipment?.type as string | null | undefined) ?? null,
    quantity: r.quantity_requested as number,
    venueName: (venue?.name as string | undefined) ?? null,
    notes: (r.notes as string | null) ?? null,
    status: r.status as string,
    venueBookingCancellationReason: (booking?.cancellation_reason as string | null | undefined) ?? null,
    createdAt: new Date(r.created_at as string),
  };
};

export class SupabaseEquipmentRequestReader implements EquipmentRequestReader {
  constructor(private readonly db: SupabaseClient) {}

  async forEvent(eventId: string): Promise<EquipmentRequestInfo[]> {
    const { data, error } = await this.db
      .from("equipment_reservations")
      .select(
        "id, event_id, quantity_requested, notes, status, created_at, equipment:equipment(name, type), " +
          "booking:venue_bookings(cancellation_reason, venue:venues!venue_bookings_venue_id_fkey(name))",
      )
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`Reading equipment requests failed: ${error.message}`, { cause: error });
    return (data as unknown as Row[]).map(toRequest);
  }
}
