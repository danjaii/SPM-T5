import {
  ACKNOWLEDGEABLE_NOTIFICATION_TYPES,
  NO_ACCESS_LABEL,
  notificationHref,
  notificationRequiresAction,
  type NotificationAcknowledgement,
  type NotificationItem,
  type NotificationRelated,
} from "@spm-t5/shared";
import { assignmentCancelled, notAcknowledgeable, notFound, outOfDate } from "../domain/errors";
import { targetKey, type AccessReader, type Target } from "../readers/accessReader";
import {
  AcknowledgeError,
  type AssignmentState,
  type NotificationRepository,
  type NotificationRow,
} from "../repositories/notificationRepository";

export interface NotificationDeps {
  repo: NotificationRepository;
  access: AccessReader;
}

/** A row's target: a booking wins over the event, then the event; none when it points at nothing (AC2). */
function targetOf(row: NotificationRow): Target | null {
  if (row.venue_booking_id) return { kind: "venue_booking", id: row.venue_booking_id };
  if (row.event_id) return { kind: "event", id: row.event_id };
  return null;
}

/**
 * AC2, AC5, AC7: a target the caller can still see gets its name and page; one they cannot see gets no page and
 * the no-access wording, so nothing about it leaks.
 */
/** SCRUM-20: the assignment an "assigned" or "changed" notification is about; none for any other notification. */
function acknowledgeableAssignment(row: NotificationRow): string | null {
  const types: readonly string[] = ACKNOWLEDGEABLE_NOTIFICATION_TYPES;
  return row.technical_staff_assignment_id && types.includes(row.type) ? row.technical_staff_assignment_id : null;
}

/**
 * SCRUM-20/AC4, AC5: only the notification about the assignment's current details counts (one sent before a later change
 * is out of date); it can be acknowledged while the assignment is active and not yet acknowledged. An assignment the
 * caller cannot read cannot be acknowledged.
 */
function acknowledgementOf(row: NotificationRow, state: AssignmentState | undefined): NotificationAcknowledgement {
  const current = state !== undefined && Date.parse(row.created_at) >= Date.parse(state.changedAt);
  if (!state || !current) return { canAcknowledge: false, acknowledgedAt: null };
  return { canAcknowledge: !state.cancelledAt && !state.acknowledgedAt, acknowledgedAt: state.acknowledgedAt };
}

function toItem(
  row: NotificationRow,
  role: string | undefined,
  labels: Map<string, string>,
  states: Map<string, AssignmentState>,
): NotificationItem {
  const target = targetOf(row);
  let related: NotificationRelated | null = null;
  if (target) {
    const label = labels.get(targetKey(target));
    related = label
      ? { kind: target.kind, id: target.id, label, href: notificationHref(target.kind, target.id, role) }
      : { kind: target.kind, id: target.id, label: NO_ACCESS_LABEL, href: null };
  }
  const assignment = acknowledgeableAssignment(row);
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    isRead: row.is_read,
    createdAt: row.created_at,
    readAt: row.read_at,
    related,
    actionRequired: notificationRequiresAction(row.type),
    ...(assignment ? { acknowledgement: acknowledgementOf(row, states.get(assignment)) } : {}),
  };
}

async function present(deps: NotificationDeps, userId: string, rows: NotificationRow[]): Promise<NotificationItem[]> {
  if (rows.length === 0) return [];
  const targets = rows.map(targetOf).filter((t): t is Target => t !== null);
  const assignments = [...new Set(rows.map(acknowledgeableAssignment).filter((id): id is string => id !== null))];
  const [role, labels, states] = await Promise.all([
    deps.access.roleOf(userId),
    deps.access.visibleLabels(targets),
    assignments.length > 0 ? deps.repo.assignmentStates(assignments) : Promise.resolve(new Map<string, AssignmentState>()),
  ]);
  return rows.map((row) => toItem(row, role, labels, states));
}

/** AC1, AC6: the caller's own notifications, newest first, with how many are unread. */
export async function listNotifications(
  deps: NotificationDeps,
  userId: string,
  limit: number,
): Promise<{ items: NotificationItem[]; unreadCount: number }> {
  const [rows, unreadCount] = await Promise.all([deps.repo.list(userId, limit), deps.repo.countUnread(userId)]);
  return { items: await present(deps, userId, rows), unreadCount };
}

export async function unreadCount(deps: NotificationDeps, userId: string): Promise<number> {
  return deps.repo.countUnread(userId);
}

/**
 * AC4: marks one of the caller's notifications read. Idempotent: a read one is returned as it is. A row that is
 * someone else's, or does not exist, is 404 either way, so ids cannot be probed (AC6).
 */
export async function markNotificationRead(
  deps: NotificationDeps,
  userId: string,
  id: string,
): Promise<NotificationItem> {
  const existing = await deps.repo.find(userId, id);
  if (!existing) throw notFound();
  const row = existing.is_read ? existing : await deps.repo.markRead(userId, id);
  if (!row) throw notFound();
  const [item] = await present(deps, userId, [row]);
  return item;
}

/** acknowledge_technical_assignment()'s refusals (migration 41) as answers; anything else is unexpected (500). */
function translate(err: unknown): never {
  if (err instanceof AcknowledgeError) {
    if (err.code === "P0002") throw notFound();
    if (err.code === "22023") throw notAcknowledgeable();
    if (err.code === "CS020") throw assignmentCancelled();
    if (err.code === "CS021") throw outOfDate();
  }
  throw err;
}

/**
 * SCRUM-20/AC4, AC5: the technician acknowledges an assignment notification; the database marks it read and the
 * assignment acknowledged together. Someone else's notification is 404, as for marking read.
 */
export async function acknowledgeNotification(deps: NotificationDeps, userId: string, id: string): Promise<NotificationItem> {
  if (!(await deps.repo.find(userId, id))) throw notFound();
  await deps.repo.acknowledge(id).catch(translate);
  const row = await deps.repo.find(userId, id);
  if (!row) throw notFound();
  const [item] = await present(deps, userId, [row]);
  return item;
}
