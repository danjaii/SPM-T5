/** A `notifications` row as the database stores it. */
export interface NotificationRow {
  id: string;
  user_id: string;
  event_id: string | null;
  venue_booking_id: string | null;
  /** SCRUM-20: the on-site assignment an assignment notification is about (migration 41). */
  technical_staff_assignment_id?: string | null;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
}

/** SCRUM-20: what acknowledging an assignment notification depends on (ISO timestamps). */
export interface AssignmentState {
  acknowledgedAt: string | null;
  cancelledAt: string | null;
  /** When its venue booking or period last changed; a notification older than this is out of date. */
  changedAt: string;
}

/** SCRUM-20: acknowledge_technical_assignment() (migration 41) refused, with this SQLSTATE. */
export class AcknowledgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AcknowledgeError";
  }
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
  /** SCRUM-20: the assignments with these ids that the caller can read (migration 41: the technician reads their own). */
  assignmentStates(ids: string[]): Promise<Map<string, AssignmentState>>;
  /** SCRUM-20: acknowledges the assignment a notification is about; throws AcknowledgeError when refused. */
  acknowledge(id: string): Promise<void>;
}
