import type { SupabaseClient } from "@supabase/supabase-js";

/** One event: what a reservation needs to know about it. */
export interface EventInfo {
  id: string;
  name: string;
  status: string;
  /** When the event starts and ends (UTC), or null if no date was set. */
  start: Date | null;
  end: Date | null;
  /** The assigned event coordinator's name, or null if none is assigned yet. */
  coordinatorName: string | null;
  /** SCRUM-86/AC7: the assigned event coordinator's id, or null if none is assigned yet. */
  assignedCoordinatorId: string | null;
  /** SCRUM-153/AC5: the event's organiser, who may view (not change) its equipment requests. */
  organiserId: string;
}

export interface EventReader {
  /** The event with this id, or undefined if there is none (or the caller may not see it). */
  find(id: string): Promise<EventInfo | undefined>;
  /** Every event the caller can see; the service picks the ones that can be reserved for. */
  list(): Promise<EventInfo[]>;
}

type Row = Record<string, unknown>;

const COLUMNS =
  "id, name, status, preferred_start_datetime, preferred_end_datetime, assigned_coordinator_id, organiser_id, coordinator:users!events_assigned_coordinator_id_fkey(full_name)";

const date = (value: unknown) => (value ? new Date(value as string) : null);

const toEvent = (r: Row): EventInfo => ({
  id: r.id as string,
  name: r.name as string,
  status: r.status as string,
  start: date(r.preferred_start_datetime),
  end: date(r.preferred_end_datetime),
  coordinatorName: ((r.coordinator as Row | null)?.full_name as string | undefined) ?? null,
  assignedCoordinatorId: (r.assigned_coordinator_id as string | null) ?? null,
  organiserId: r.organiser_id as string,
});

export class SupabaseEventReader implements EventReader {
  constructor(private readonly db: SupabaseClient) {}

  async find(id: string): Promise<EventInfo | undefined> {
    const { data, error } = await this.db.from("events").select(COLUMNS).eq("id", id).maybeSingle();
    if (error) throw new Error(`Reading the event failed: ${error.message}`, { cause: error });
    return data ? toEvent(data as unknown as Row) : undefined;
  }

  async list(): Promise<EventInfo[]> {
    const { data, error } = await this.db.from("events").select(COLUMNS);
    if (error) throw new Error(`Reading events failed: ${error.message}`, { cause: error });
    return (data as unknown as Row[]).map(toEvent);
  }
}
