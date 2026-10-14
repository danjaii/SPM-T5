import type { SupabaseClient } from "@supabase/supabase-js";

/** SCRUM-86/AC1: one request to save, as the service hands it over. */
export interface NewEquipmentRequest {
  eventId: string;
  equipmentId: string;
  quantity: number;
  venueBookingId: string | null;
  notes: string | null;
  /** The period it is needed for (UTC), copied from the venue booking. */
  start: Date;
  end: Date;
  /** The coordinator making it (from the login, never from the form). */
  requestedBy: string;
}

/** Saves a request. */
export interface EquipmentRequestWriter {
  create(request: NewEquipmentRequest): Promise<{ id: string }>;
}

/**
 * The real writer: a plain insert as the caller. Migration 25's restrictive policy refuses it unless the caller is
 * the event's assigned coordinator, the event is not finished, and the row is a Submitted request in their name.
 */
export class SupabaseEquipmentRequestWriter implements EquipmentRequestWriter {
  constructor(private readonly db: SupabaseClient) {}

  async create(request: NewEquipmentRequest): Promise<{ id: string }> {
    const { data, error } = await this.db
      .from("equipment_reservations")
      .insert({
        event_id: request.eventId,
        equipment_id: request.equipmentId,
        quantity_requested: request.quantity,
        venue_booking_id: request.venueBookingId,
        notes: request.notes,
        start_datetime: request.start.toISOString(),
        end_datetime: request.end.toISOString(),
        status: "requested",
        requested_by: request.requestedBy,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Saving the equipment request failed: ${error.message}`, { cause: error });
    return { id: (data as { id: string }).id };
  }
}
