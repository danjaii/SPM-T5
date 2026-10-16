import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AcknowledgeError,
  type AssignmentState,
  type NotificationRepository,
  type NotificationRow,
} from "./notificationRepository";

const COLUMNS =
  "id, user_id, event_id, venue_booking_id, technical_staff_assignment_id, type, title, message, is_read, created_at, read_at";

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

  /** SCRUM-20: read as the caller, so only assignments they may see (migration 41: the technician's own). */
  async assignmentStates(ids: string[]): Promise<Map<string, AssignmentState>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await this.db
      .from("technical_staff_assignments")
      .select("id, acknowledged_at, cancelled_at, changed_at")
      .in("id", ids);
    if (error) throw new Error(error.message);
    return new Map(
      (data as { id: string; acknowledged_at: string | null; cancelled_at: string | null; changed_at: string }[]).map((a) => [
        a.id,
        { acknowledgedAt: a.acknowledged_at, cancelledAt: a.cancelled_at, changedAt: a.changed_at },
      ]),
    );
  }

  /** SCRUM-20: acknowledge_technical_assignment() checks the caller, the type and the assignment, then saves both. */
  async acknowledge(id: string): Promise<void> {
    const { error } = await this.db.rpc("acknowledge_technical_assignment", { p_notification_id: id });
    if (error) throw new AcknowledgeError(error.code ?? "", error.message);
  }
}
