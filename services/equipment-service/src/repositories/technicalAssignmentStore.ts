import type { SupabaseClient } from "@supabase/supabase-js";
import type { TechnicalAssignmentInput } from "@spm-t5/shared";

/** SCRUM-20: one on-site technical support assignment, with its technician's and venue's names. */
export interface AssignmentRecord {
  id: string;
  eventId: string;
  staffId: string;
  staffName: string | null;
  venueBookingId: string | null;
  venueName: string | null;
  /** UTC. */
  start: Date;
  end: Date;
  note: string | null;
  acknowledgedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
}

/** A refusal from the database functions (migration 41), by its SQLSTATE. */
export class AssignmentStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AssignmentStoreError";
  }
}

/**
 * Where assignments are read and written, as the caller. Writes go through migration 41's security definer functions,
 * which check the caller, the event, the technician and the venue booking again, and write the notification.
 */
export interface TechnicalAssignmentStore {
  /** The event's assignments, oldest first. */
  forEvent(eventId: string): Promise<AssignmentRecord[]>;
  find(id: string): Promise<AssignmentRecord | undefined>;
  /** Active Technical Support Staff, by name. */
  staffOptions(): Promise<{ id: string; name: string }[]>;
  assign(eventId: string, input: TechnicalAssignmentInput & { staffId: string }): Promise<string>;
  change(id: string, input: TechnicalAssignmentInput): Promise<void>;
  cancel(id: string, reason: string): Promise<void>;
}

type Row = Record<string, unknown>;

// "!staff_id" and "!venue_id": users and venues are linked twice (assigned_by and cancelled_by; suggested_venue_id)
const COLUMNS =
  "id, event_id, staff_id, venue_booking_id, start_datetime, end_datetime, role_note, acknowledged_at, cancelled_at, " +
  "cancellation_reason, assigned_at, staff:users!staff_id(full_name), booking:venue_bookings(venue:venues!venue_id(name))";

const date = (v: unknown) => (v ? new Date(v as string) : null);

export function toAssignmentRecord(r: Row): AssignmentRecord {
  const booking = r.booking as Row | null;
  const venue = booking?.venue as Row | null | undefined;
  return {
    id: r.id as string,
    eventId: r.event_id as string,
    staffId: r.staff_id as string,
    staffName: ((r.staff as Row | null)?.full_name as string | undefined) ?? null,
    venueBookingId: (r.venue_booking_id as string | null) ?? null,
    venueName: (venue?.name as string | undefined) ?? null,
    start: new Date(r.start_datetime as string),
    end: new Date(r.end_datetime as string),
    note: (r.role_note as string | null) ?? null,
    acknowledgedAt: date(r.acknowledged_at),
    cancelledAt: date(r.cancelled_at),
    cancellationReason: (r.cancellation_reason as string | null) ?? null,
  };
}

export class SupabaseTechnicalAssignmentStore implements TechnicalAssignmentStore {
  constructor(private readonly db: SupabaseClient) {}

  async forEvent(eventId: string): Promise<AssignmentRecord[]> {
    const { data, error } = await this.db
      .from("technical_staff_assignments")
      .select(COLUMNS)
      .eq("event_id", eventId)
      .order("assigned_at", { ascending: true });
    if (error) throw new Error(`Reading assignments failed: ${error.message}`, { cause: error });
    return (data as unknown as Row[]).map(toAssignmentRecord);
  }

  async find(id: string): Promise<AssignmentRecord | undefined> {
    const { data, error } = await this.db.from("technical_staff_assignments").select(COLUMNS).eq("id", id).maybeSingle();
    if (error) throw new Error(`Reading the assignment failed: ${error.message}`, { cause: error });
    return data ? toAssignmentRecord(data as unknown as Row) : undefined;
  }

  async staffOptions(): Promise<{ id: string; name: string }[]> {
    const { data, error } = await this.db
      .from("users")
      .select("id, full_name")
      .eq("role", "technical_support_staff")
      .eq("is_active", true)
      .order("full_name");
    if (error) throw new Error(`Reading technical support staff failed: ${error.message}`, { cause: error });
    return (data as { id: string; full_name: string }[]).map((u) => ({ id: u.id, name: u.full_name }));
  }

  private async call(fn: string, args: Record<string, unknown>) {
    const { data, error } = await this.db.rpc(fn, args);
    if (error) throw new AssignmentStoreError(error.code ?? "", error.message);
    return data;
  }

  async assign(eventId: string, input: TechnicalAssignmentInput & { staffId: string }): Promise<string> {
    return (await this.call("assign_technical_staff", {
      p_event_id: eventId,
      p_staff_id: input.staffId,
      p_venue_booking_id: input.venueBookingId,
      p_start: input.start,
      p_end: input.end,
      p_note: input.note,
    })) as string;
  }

  async change(id: string, input: TechnicalAssignmentInput): Promise<void> {
    await this.call("change_technical_assignment", {
      p_assignment_id: id,
      p_venue_booking_id: input.venueBookingId,
      p_start: input.start,
      p_end: input.end,
      p_note: input.note,
    });
  }

  async cancel(id: string, reason: string): Promise<void> {
    await this.call("cancel_technical_assignment", { p_assignment_id: id, p_reason: reason });
  }
}
