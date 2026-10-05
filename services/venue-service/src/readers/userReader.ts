import type { SupabaseClient } from "@supabase/supabase-js";

/** Display names for the people on a request, so Venue Staff see "who" rather than an id (SCRUM-37). */
export interface UserReader {
  /** Full names by user id; ids with no user row are simply absent. */
  namesOf(ids: string[]): Promise<Map<string, string>>;
}

export class SupabaseUserReader implements UserReader {
  constructor(private readonly db: SupabaseClient) {}

  async namesOf(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await this.db.from("users").select("id, full_name").in("id", ids);
    if (error) throw new Error(`Reading users failed: ${error.message}`, { cause: error });
    return new Map((data as unknown as { id: string; full_name: string }[]).map((u) => [u.id, u.full_name]));
  }
}
