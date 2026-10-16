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

/** SCRUM-88/AC1: the new details for a request, as the service hands them over. */
export interface EquipmentRequestChange {
  requestId: string;
  equipmentId: string;
  quantity: number;
  venueBookingId: string | null;
  notes: string | null;
  /** The period it is needed for (UTC), copied from the venue booking. */
  start: Date;
  end: Date;
}

/** What update_equipment_request() (migration 37) answered. */
export type ChangeOutcome = "updated" | "not_found" | "not_editable" | "event_locked" | "venue_invalid";

/** Saves a request, and (SCRUM-88) a coordinator's change to one. */
export interface EquipmentRequestWriter {
  create(request: NewEquipmentRequest): Promise<{ id: string }>;
  update(change: EquipmentRequestChange): Promise<ChangeOutcome>;
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

  /**
   * SCRUM-88: calls update_equipment_request() (migration 37) as the caller. It refuses anyone but the event's
   * assigned coordinator, and saves the change and sends the request back to Submitted in one step.
   */
  async update(change: EquipmentRequestChange): Promise<ChangeOutcome> {
    const { data, error } = await this.db.rpc("update_equipment_request", {
      p_request_id: change.requestId,
      p_equipment_id: change.equipmentId,
      p_quantity: change.quantity,
      p_venue_booking_id: change.venueBookingId,
      p_notes: change.notes,
      p_start: change.start.toISOString(),
      p_end: change.end.toISOString(),
    });
    if (error) throw new Error(`Changing the equipment request failed: ${error.message}`, { cause: error });
    return data as ChangeOutcome;
  }
}

/** SCRUM-87/AC4, AC5: a status change, as the service hands it over. dbStatus is under_review, approved or rejected. */
export interface EquipmentRequestReview {
  requestId: string;
  dbStatus: string;
  /** Cannot Fulfil only. */
  reason: string | null;
}

/** What review_equipment_request() (migration 32) answered. */
export type ReviewOutcome =
  | { outcome: "updated" | "not_found" | "not_reviewable" | "event_locked" }
  | { outcome: "insufficient"; available: number };

/** SCRUM-87: changes a request's status. The real one checks and saves in one step inside the database. */
export interface EquipmentRequestReviewer {
  review(review: EquipmentRequestReview): Promise<ReviewOutcome>;
}

/**
 * The real reviewer: calls review_equipment_request() (migration 32) as the caller. It refuses anyone but Technical
 * Support Staff, and checks what is free and saves Arranged in one step, so two people cannot arrange the last units.
 */
export class SupabaseEquipmentRequestReviewer implements EquipmentRequestReviewer {
  constructor(private readonly db: SupabaseClient) {}

  async review(review: EquipmentRequestReview): Promise<ReviewOutcome> {
    const { data, error } = await this.db.rpc("review_equipment_request", {
      p_request_id: review.requestId,
      p_status: review.dbStatus,
      p_reason: review.reason,
    });
    if (error) throw new Error(`Reviewing the equipment request failed: ${error.message}`, { cause: error });
    const row = (data as Array<{ outcome: ReviewOutcome["outcome"]; available: number | null }>)[0];
    return row.outcome === "insufficient" ? { outcome: "insufficient", available: row.available ?? 0 } : { outcome: row.outcome };
  }
}
