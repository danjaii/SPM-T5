import type { SupabaseClient } from "@supabase/supabase-js";
import type { LayoutTypeView } from "@spm-t5/shared";
import { forbidden, layoutTypeInUse, notFound, validationFailed } from "../domain/errors";

/** SCRUM-181: reads, adds, renames and deletes room layout types. */
export interface LayoutTypeStore {
  list(): Promise<LayoutTypeView[]>;
  create(name: string): Promise<{ id: string; name: string }>;
  rename(id: string, name: string): Promise<{ id: string; name: string }>;
  /** Throws a 409 LAYOUT_TYPE_IN_USE (nothing deleted) when a venue supports the type or an event request prefers it. */
  remove(id: string): Promise<{ id: string; name: string }>;
}

const INSUFFICIENT_PRIVILEGE = "42501";
const NO_SUCH_LAYOUT_TYPE = "P0002";
const INVALID_NAME = "22023";
const DUPLICATE_NAME = "23505";

interface DeleteResult {
  deleted: boolean;
  name: string;
  venues?: { id: string; name: string }[];
  event_count?: number;
}

interface ListRow {
  id: string;
  name: string;
  is_active: boolean;
  venue_supported_layouts: { count: number }[] | null;
}

/**
 * Calls the create_layout_type, rename_layout_type and delete_layout_type database functions (migration 76) as the caller, and
 * reads the list as the caller. The functions allow venue staff only, so RLS stays the authority; the route's role check is
 * just the friendly 403.
 */
export class SupabaseLayoutTypeStore implements LayoutTypeStore {
  constructor(private readonly db: SupabaseClient) {}

  async list(): Promise<LayoutTypeView[]> {
    const { data, error } = await this.db.from("room_layouts").select("id, name, is_active, venue_supported_layouts(count)").order("name");
    if (error) throw new Error(`Reading the layout types failed: ${error.message}`, { cause: error });
    return ((data ?? []) as unknown as ListRow[]).map((r) => ({
      id: r.id,
      name: r.name,
      isActive: r.is_active,
      venueCount: r.venue_supported_layouts?.[0]?.count ?? 0,
    }));
  }

  async create(name: string): Promise<{ id: string; name: string }> {
    const { data, error } = await this.db.rpc("create_layout_type", { p_name: name });
    if (error) throw refusal(error, "add");
    return data as { id: string; name: string };
  }

  async rename(id: string, name: string): Promise<{ id: string; name: string }> {
    const { data, error } = await this.db.rpc("rename_layout_type", { p_id: id, p_name: name });
    if (error) throw refusal(error, "rename");
    return data as { id: string; name: string };
  }

  async remove(id: string): Promise<{ id: string; name: string }> {
    const { data, error } = await this.db.rpc("delete_layout_type", { p_id: id });
    if (error) throw refusal(error, "delete");
    const result = data as DeleteResult;
    if (!result.deleted) throw layoutTypeInUse(result.name, { venues: result.venues ?? [], eventCount: result.event_count ?? 0 });
    return { id, name: result.name };
  }
}

/** What a refused call becomes: the friendly answer for the refusals the functions raise on purpose, anything else as it is. */
function refusal(error: { code?: string; message: string }, verb: "add" | "rename" | "delete"): Error {
  if (error.code === INSUFFICIENT_PRIVILEGE) return forbidden(`Only venue staff can ${verb} a layout type.`);
  if (error.code === NO_SUCH_LAYOUT_TYPE) return notFound("Layout type not found.");
  if (error.code === INVALID_NAME || error.code === DUPLICATE_NAME) return validationFailed({ name: error.message });
  return new Error(`Saving the layout type failed: ${error.message}`, { cause: error });
}
