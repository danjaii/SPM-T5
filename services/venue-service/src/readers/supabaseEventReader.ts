import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventInfo, EventReader } from "./eventReader";

const COLUMNS =
  "id, name, status, assigned_coordinator_id, expected_attendance, accessibility_requirements, " +
  "preferred_start_datetime, preferred_end_datetime, room_layouts(name)";

type Row = Record<string, unknown>;

const date = (v: unknown) => (v ? new Date(v as string) : null);

function toEventInfo(row: Row): EventInfo {
  // PostgREST returns a to-one embed as an object (an array in some client versions); accept both.
  const layout = row.room_layouts as { name: string } | { name: string }[] | null | undefined;
  const layoutName = Array.isArray(layout) ? layout[0]?.name : layout?.name;
  return {
    id: row.id as string,
    name: row.name as string,
    status: row.status as string,
    assignedCoordinatorId: (row.assigned_coordinator_id as string | null) ?? null,
    expectedAttendance: (row.expected_attendance as number | null) ?? null,
    venueRequirements: layoutName ?? null,
    accessibilityNeeds: (row.accessibility_requirements as string | null) ?? null,
    proposedStart: date(row.preferred_start_datetime),
    proposedEnd: date(row.preferred_end_datetime),
  };
}

/** Reads `events` directly from the shared database as the caller, so RLS applies (ADR 0001). */
export class SupabaseEventReader implements EventReader {
  constructor(private readonly db: SupabaseClient) {}

  async getById(eventId: string): Promise<EventInfo | null> {
    const { data, error } = await this.db.from("events").select(COLUMNS).eq("id", eventId).maybeSingle();
    if (error) throw new Error(`Reading event failed: ${error.message}`, { cause: error });
    return data ? toEventInfo(data as unknown as Row) : null;
  }

  async listIdsAssignedTo(userId: string): Promise<string[]> {
    const { data, error } = await this.db.from("events").select("id").eq("assigned_coordinator_id", userId);
    if (error) throw new Error(`Listing events failed: ${error.message}`, { cause: error });
    return (data ?? []).map((r) => r.id as string);
  }
}
