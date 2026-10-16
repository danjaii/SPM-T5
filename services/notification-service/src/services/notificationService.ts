import {
  NO_ACCESS_LABEL,
  notificationHref,
  type NotificationItem,
  type NotificationRelated,
} from "@spm-t5/shared";
import { notFound } from "../domain/errors";
import { targetKey, type AccessReader, type Target } from "../readers/accessReader";
import type { NotificationRepository, NotificationRow } from "../repositories/notificationRepository";

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
function toItem(row: NotificationRow, role: string | undefined, labels: Map<string, string>): NotificationItem {
  const target = targetOf(row);
  let related: NotificationRelated | null = null;
  if (target) {
    const label = labels.get(targetKey(target));
    related = label
      ? { kind: target.kind, id: target.id, label, href: notificationHref(target.kind, target.id, role) }
      : { kind: target.kind, id: target.id, label: NO_ACCESS_LABEL, href: null };
  }
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    isRead: row.is_read,
    createdAt: row.created_at,
    readAt: row.read_at,
    related,
  };
}

async function present(deps: NotificationDeps, userId: string, rows: NotificationRow[]): Promise<NotificationItem[]> {
  if (rows.length === 0) return [];
  const targets = rows.map(targetOf).filter((t): t is Target => t !== null);
  const [role, labels] = await Promise.all([deps.access.roleOf(userId), deps.access.visibleLabels(targets)]);
  return rows.map((row) => toItem(row, role, labels));
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
