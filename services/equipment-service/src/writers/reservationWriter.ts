import type { SupabaseClient } from "@supabase/supabase-js";

/** SCRUM-19: one reservation to save, as the service hands it over. */
export interface NewReservation {
  eventId: string;
  equipmentId: string;
  quantity: number;
  /** The period as UTC instants (the form's date and times are Singapore time). */
  start: Date;
  end: Date;
  /** The Technical Support Staff member making it (from the login, never from the form). */
  reservedBy: string;
}

/** Saved, with how many are still free afterwards; or refused, with how many were free. */
export type ReserveOutcome =
  | { ok: true; id: string; availableAfter: number }
  | { ok: false; available: number };

/** Saves a reservation. The real one checks what is free and saves in one step inside the database. */
export interface ReservationWriter {
  reserve(reservation: NewReservation): Promise<ReserveOutcome>;
}

/**
 * The real writer: calls the database function reserve_equipment (migration 12), which locks the equipment, checks
 * what is free and saves in one step, so two people reserving the last units cannot both succeed. It runs as the
 * caller (their token), and the function takes the reserving user from that login, so `reservedBy` is not sent.
 */
export class SupabaseReservationWriter implements ReservationWriter {
  constructor(private readonly db: SupabaseClient) {}

  async reserve(reservation: NewReservation): Promise<ReserveOutcome> {
    const { data, error } = await this.db.rpc("reserve_equipment", {
      p_event_id: reservation.eventId,
      p_equipment_id: reservation.equipmentId,
      p_quantity: reservation.quantity,
      p_start: reservation.start.toISOString(),
      p_end: reservation.end.toISOString(),
    });
    if (error) throw new Error(`Reserving equipment failed: ${error.message}`, { cause: error });
    const row = (data as Array<{ ok: boolean; reservation_id: string | null; available: number }>)[0];
    return row.ok ? { ok: true, id: row.reservation_id as string, availableAfter: row.available } : { ok: false, available: row.available };
  }
}
