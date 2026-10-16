/** A `notifications` row as the database stores it. */
export interface NotificationRow {
  id: string;
  user_id: string;
  event_id: string | null;
  venue_booking_id: string | null;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
}

/**
 * Where notifications are read and marked read. The Supabase implementation queries as the caller, so row level
 * security (migration 35) already limits every call to their own rows; the `userId` is a second, explicit filter.
 */
export interface NotificationRepository {
  /** The user's newest notifications first. */
  list(userId: string, limit: number): Promise<NotificationRow[]>;
  countUnread(userId: string): Promise<number>;
  /** One of the user's notifications, or null when it is not theirs or does not exist. */
  find(userId: string, id: string): Promise<NotificationRow | null>;
  /** Marks one of the user's notifications read; null when it is not theirs. */
  markRead(userId: string, id: string): Promise<NotificationRow | null>;
}
