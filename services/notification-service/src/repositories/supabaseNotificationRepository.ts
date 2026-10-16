import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationRepository, NotificationRow } from "./notificationRepository";

const COLUMNS = "id, user_id, event_id, venue_booking_id, type, title, message, is_read, created_at, read_at";

/** Reads and updates `notifications` as the signed-in caller (user-scoped client), so RLS applies. */
export class SupabaseNotificationRepository implements NotificationRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(userId: string, limit: number): Promise<NotificationRow[]> {
    const { data, error } = await this.db
      .from("notifications")
      .select(COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as NotificationRow[];
  }

  async countUnread(userId: string): Promise<number> {
    const { count, error } = await this.db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_read", false);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async find(userId: string, id: string): Promise<NotificationRow | null> {
    const { data, error } = await this.db
      .from("notifications")
      .select(COLUMNS)
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as NotificationRow | null) ?? null;
  }

  async markRead(userId: string, id: string): Promise<NotificationRow | null> {
    // Only is_read may be written (column grant, migration 35); the trigger sets read_at.
    const { data, error } = await this.db
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id)
      .eq("user_id", userId)
      .select(COLUMNS)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as NotificationRow | null) ?? null;
  }
}
