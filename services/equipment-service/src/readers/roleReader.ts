import type { SupabaseClient } from "@supabase/supabase-js";
import { isRole, type Role } from "@spm-t5/shared";

/** Who is this user? Lets the service give a clear 403 to roles the page is not for. */
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
