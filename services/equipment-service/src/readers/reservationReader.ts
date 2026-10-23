import type { SupabaseClient } from "@supabase/supabase-js";

/** One equipment reservation, in whatever status. */
export interface ReservationInfo {
  equipmentId: string;
  start: Date;
  end: Date;
  status: string;
  quantityRequested: number;
  /** Set when staff approved a (possibly smaller) amount. */
  quantityReserved: number | null;
  /** SCRUM-137: the event the units are held for, to say where they are. */
  eventName: string;
}

export interface ReservationReader {
  /** Reservations of this equipment whose period overlaps [start, end). */
  overlapping(equipmentId: string, start: Date, end: Date): Promise<ReservationInfo[]>;
}

type Row = Record<string, unknown>;

const toReservation = (r: Row): ReservationInfo => ({
  equipmentId: r.equipment_id as string,
  start: new Date(r.start_datetime as string),
  end: new Date(r.end_datetime as string),
  status: r.status as string,
  quantityRequested: r.quantity_requested as number,
  quantityReserved: (r.quantity_reserved as number | null) ?? null,
  eventName: ((r.event as Row | null)?.name as string | undefined) ?? "Unknown event",
});

export class SupabaseReservationReader implements ReservationReader {
  constructor(private readonly db: SupabaseClient) {}

  async overlapping(equipmentId: string, start: Date, end: Date): Promise<ReservationInfo[]> {
    // Overlap: the reservation starts before the period ends and ends after it starts.
    const { data, error } = await this.db
      .from("equipment_reservations")
      .select("equipment_id, start_datetime, end_datetime, status, quantity_requested, quantity_reserved, event:events(name)")
      .eq("equipment_id", equipmentId)
      .lt("start_datetime", end.toISOString())
      .gt("end_datetime", start.toISOString());
    if (error) throw new Error(`Reading equipment reservations failed: ${error.message}`, { cause: error });
    return (data as unknown as Row[]).map(toReservation);
  }
}
