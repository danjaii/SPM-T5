"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NotificationItem } from "@spm-t5/shared";
import { markNotificationRead } from "@/lib/notifications";

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

  async function open(item: NotificationItem) {
    if (!(await markRead(item))) return;
    if (item.related?.href) router.push(item.related.href);
  }

  if (items.length === 0) return <p className="empty">You have no notifications.</p>;

  return (
    <>
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
            </button>
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
