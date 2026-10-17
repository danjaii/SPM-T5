"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NotificationItem } from "@spm-t5/shared";
import { formatSgt } from "@/lib/bookingQueue";
import { acknowledgeNotification, markNotificationRead } from "@/lib/notifications";

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" });

// SCRUM-46: the signed-in user's notifications. Unread rows get a highlight and a visible "Unread" word, so colour
// alone never carries the meaning (AC3). Selecting a row marks it read, then opens its target when the user can
// still see it (AC4, AC5); a target they cannot see shows the no-access wording and goes nowhere (AC7).
export function NotificationList({ items: initial }: { items: NotificationItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string>();

  async function markRead(item: NotificationItem): Promise<boolean> {
    if (item.isRead) return true;
    const { ok, data } = await markNotificationRead(item.id);
    if (!ok) {
      setError(data.error ?? "We couldn't mark that notification as read. Please try again.");
      return false;
    }
    setError(undefined);
    setItems((current) => current.map((i) => (i.id === item.id ? { ...i, isRead: true, readAt: data.readAt ?? i.readAt } : i)));
    router.refresh();
    return true;
  }

  // SCRUM-20/AC4, AC5: acknowledging an assignment notification marks it read and the assignment acknowledged
  async function acknowledge(item: NotificationItem) {
    const { ok, data } = await acknowledgeNotification(item.id);
    if (!ok) {
      setError(data.error ?? "We couldn't acknowledge that notification. Please try again.");
      return;
    }
    setError(undefined);
    setItems((current) => current.map((i) => (i.id === item.id ? data : i)));
    router.refresh();
  }

  async function open(item: NotificationItem) {
    if (!(await markRead(item))) return;
    if (item.related?.href) router.push(item.related.href);
  }

  // counted from the rows on screen, so it never disagrees with them while a refresh is on its way
  const unreadCount = items.filter((i) => !i.isRead).length;

  if (items.length === 0) {
    return (
      <>
        <p className="dash__lede">0 unread</p>
        <p className="empty">You have no notifications.</p>
      </>
    );
  }

  return (
    <>
      <p className="dash__lede">{unreadCount} unread</p>
      {error && <div className="alert alert--error" role="alert">{error}</div>}
      <ul className="notifications">
        {items.map((item) => (
          <li key={item.id} className={`notification${item.isRead ? "" : " notification--unread"}`}>
            <button type="button" className="notification__open" onClick={() => open(item)}>
              <span className="notification__title">
                {!item.isRead && <span className="status-badge status-badge--pending">Unread</span>} {item.title}
              </span>
              <span className="notification__message">{item.message}</span>
              {item.related && (
                <span className="notification__related">
                  {item.related.href ? `Related: ${item.related.label}` : item.related.label}
                </span>
              )}
              <span className="notification__time">{formatWhen(item.createdAt)}</span>
              {item.acknowledgement?.acknowledgedAt && (
                <span className="notification__related">Acknowledged on {formatSgt(item.acknowledgement.acknowledgedAt)}</span>
              )}
            </button>
            {item.acknowledgement?.canAcknowledge && (
              <button type="button" className="btn" onClick={() => acknowledge(item)}>
                Acknowledge
              </button>
            )}
            {!item.isRead && (
              <button type="button" className="btn btn--secondary" onClick={() => markRead(item)}>
                Mark as read
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
