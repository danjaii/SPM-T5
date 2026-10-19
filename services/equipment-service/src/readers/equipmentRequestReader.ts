import type { SupabaseClient } from "@supabase/supabase-js";

/** SCRUM-86/AC2: one of an event's equipment requests (a row of equipment_reservations), with the names to show. */
export interface EquipmentRequestInfo {
  id: string;
  eventId: string;
  /** SCRUM-87/AC1, AC3: the event it is for. eventStart is null if the event has no date yet. */
  eventName: string;
  eventStatus: string;
  eventStart: Date | null;
  /** SCRUM-88/AC1: the item, so the change form starts on it. */
  equipmentId: string;
  equipmentName: string;
  equipmentType: string | null;
  quantity: number;
  /** The booked venue, or null for a row made before requests named one. */
  venueName: string | null;
  /** SCRUM-102: the venue booking it is for (venue names repeat when a venue is booked twice), or null as above. */
  venueBookingId: string | null;
  notes: string | null;
  /** The DB equipment_reservation_status; equipmentRequestStatusOf() turns it into what the user sees. */
  status: string;
  /** SCRUM-87/AC3: the period the equipment is needed for (UTC). */
  start: Date;
  end: Date;
  /** SCRUM-87/AC5: why it cannot be fulfilled, once staff said so. */
  reviewReason: string | null;
  /** SCRUM-102 (102-S31): why its venue booking was cancelled, which released this equipment; null otherwise. */
  venueBookingCancellationReason: string | null;
  /** SCRUM-88/AC8: who last changed it (their name) and when; null if it has not been changed since it was made. */
  lastChangedBy: string | null;
  lastChangedAt: Date | null;
  createdAt: Date;
  /** SCRUM-113: the event's changes that sent it back for review ({ field: { from, to } }), and when; null otherwise. */
  sentBackChanges: unknown;
  sentBackAt: Date | null;
}

export interface EquipmentRequestReader {
  /** Every row for the event, oldest first. */
  forEvent(eventId: string): Promise<EquipmentRequestInfo[]>;
  /** SCRUM-87/AC1: every Submitted or Under Review row; the service orders them and leaves out finished events. */
  waiting(): Promise<EquipmentRequestInfo[]>;
  /** SCRUM-87/AC3: the row with this id, or undefined if there is none. */
  find(id: string): Promise<EquipmentRequestInfo | undefined>;
}

type Row = Record<string, unknown>;

const COLUMNS =
  "id, event_id, equipment_id, venue_booking_id, quantity_requested, notes, status, start_datetime, end_datetime, " +
  "review_reason, last_edited_at, created_at, editor:users!equipment_reservations_last_edited_by_fkey(full_name), " +
  "sent_back_changes, sent_back_at, " +
  "event:events(name, status, preferred_start_datetime), equipment:equipment(name, type), " +
  "booking:venue_bookings(cancellation_reason, venue:venues!venue_bookings_venue_id_fkey(name))";

const toRequest = (r: Row): EquipmentRequestInfo => {
  const event = r.event as Row | null;
  const equipment = r.equipment as Row | null;
  const booking = r.booking as Row | null;
  const venue = booking?.venue as Row | null | undefined;
  const editor = r.editor as Row | null | undefined;
  return {
    id: r.id as string,
    eventId: r.event_id as string,
    eventName: (event?.name as string | undefined) ?? "Unknown event",
    eventStatus: (event?.status as string | undefined) ?? "",
    eventStart: event?.preferred_start_datetime ? new Date(event.preferred_start_datetime as string) : null,
    equipmentId: r.equipment_id as string,
    equipmentName: (equipment?.name as string | undefined) ?? "Unknown equipment",
    equipmentType: (equipment?.type as string | null | undefined) ?? null,
    quantity: r.quantity_requested as number,
    venueName: (venue?.name as string | undefined) ?? null,
    venueBookingId: (r.venue_booking_id as string | null | undefined) ?? null,
    notes: (r.notes as string | null) ?? null,
    status: r.status as string,
    start: new Date(r.start_datetime as string),
    end: new Date(r.end_datetime as string),
    reviewReason: (r.review_reason as string | null) ?? null,
    venueBookingCancellationReason: (booking?.cancellation_reason as string | null | undefined) ?? null,
    lastChangedBy: r.last_edited_at ? ((editor?.full_name as string | undefined) ?? "Unknown user") : null,
    lastChangedAt: r.last_edited_at ? new Date(r.last_edited_at as string) : null,
    createdAt: new Date(r.created_at as string),
    sentBackChanges: r.sent_back_changes ?? null,
    sentBackAt: r.sent_back_at ? new Date(r.sent_back_at as string) : null,
  };
};

export class SupabaseEquipmentRequestReader implements EquipmentRequestReader {
  constructor(private readonly db: SupabaseClient) {}

  async forEvent(eventId: string): Promise<EquipmentRequestInfo[]> {
    const { data, error } = await this.db
      .from("equipment_reservations")
      .select(COLUMNS)
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`Reading equipment requests failed: ${error.message}`, { cause: error });
    return (data as unknown as Row[]).map(toRequest);
  }

  async waiting(): Promise<EquipmentRequestInfo[]> {
    const { data, error } = await this.db
      .from("equipment_reservations")
      .select(COLUMNS)
      .in("status", ["requested", "under_review"]);
    if (error) throw new Error(`Reading equipment requests failed: ${error.message}`, { cause: error });
    return (data as unknown as Row[]).map(toRequest);
  }

  async find(id: string): Promise<EquipmentRequestInfo | undefined> {
    const { data, error } = await this.db.from("equipment_reservations").select(COLUMNS).eq("id", id).maybeSingle();
    // 22P02: the id is not a uuid at all, so there is no such request.
    if (error?.code === "22P02") return undefined;
    if (error) throw new Error(`Reading the equipment request failed: ${error.message}`, { cause: error });
    return data ? toRequest(data as unknown as Row) : undefined;
  }
}
