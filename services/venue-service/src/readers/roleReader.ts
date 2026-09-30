import type { SupabaseClient } from "@supabase/supabase-js";
import { isRole, type Role } from "@spm-t5/shared";

/** Who is this user? Authorisation itself is RLS; this only lets the service give clear 403s (DR2). */
export interface RoleReader {
  roleOf(userId: string): Promise<Role | undefined>;
}

export class SupabaseRoleReader implements RoleReader {
  constructor(private readonly db: SupabaseClient) {}

  async roleOf(userId: string): Promise<Role | undefined> {
    const { data } = await this.db.from("users").select("role").eq("id", userId).maybeSingle();
    return isRole(data?.role) ? data.role : undefined;
  }
}
