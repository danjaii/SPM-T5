"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NotificationItem } from "@spm-t5/shared";
import { fetchNotifications, fetchUnreadCount, markNotificationRead } from "@/lib/notifications";

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" });

// SCRUM-47/AC11: the bell in every signed-in page's header. It reads notification-service from the browser, so any
// page can show it without loading notifications on the server.
export function NotificationBell() {
  const router = useRouter();
  const wrap = useRef<HTMLDivElement>(null);
  const [unread, setUnread] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    fetchUnreadCount().then((n) => {
      if (live) setUnread(n);
    });
    return () => {
      live = false;
    };
  }, []);

  // closes on Escape, or on a click anywhere outside the bell and its list, while open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  async function toggle() {
    const opening = !open;
    setOpen(opening);
    if (!opening) return;
    const { ok, data } = await fetchNotifications();
    setError(ok ? undefined : "We couldn't load your notifications. Please try again.");
    if (ok) setItems(data.items);
  }

  // SCRUM-46/AC4: marks one read (a read one is left alone); false if the service refused
  async function markRead(item: NotificationItem): Promise<boolean> {
    if (item.isRead) return true;
    const { ok } = await markNotificationRead(item.id);
    if (!ok) return false;
    setUnread((n) => (n === null ? n : Math.max(0, n - 1)));
    setItems((current) => current?.map((i) => (i.id === item.id ? { ...i, isRead: true } : i)));
    return true;
  }

  // as on the Notifications page (SCRUM-46/AC4, AC5): mark it read first, then open what it is about
  async function choose(item: NotificationItem) {
    if (!(await markRead(item))) return;
    setOpen(false);
    if (item.related?.href) router.push(item.related.href);
  }

  // a number only when there is something unread (and the count could be loaded)
  const count = unread !== null && unread > 0 ? unread : null;

  return (
    <div className="bell-wrap" ref={wrap}>
      <button
        type="button"
        className="bell"
        aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
        aria-expanded={open}
        aria-controls="notification-menu"
        onClick={toggle}
      >
        <Bell aria-hidden="true" />
        {count && <span className="bell__count">{count > 99 ? "99+" : count}</span>}
      </button>
      {open && (
        <div id="notification-menu" className="bell-menu">
          {error && <p className="bell-menu__empty" role="alert">{error}</p>}
          {items?.length === 0 && <p className="bell-menu__empty">You have no notifications.</p>}
          {items && items.length > 0 && (
            <ul className="bell-menu__list" aria-label="Notifications">
              {items.map((item) => (
                <li key={item.id} className={`bell-menu__item${item.isRead ? "" : " bell-menu__item--unread"}`}>
                  <button type="button" className="bell-menu__open" onClick={() => choose(item)}>
                    <span className="bell-menu__title">
                      {!item.isRead && <span className="status-badge status-badge--pending">Unread</span>} {item.title}
                      {item.actionRequired && <span className="status-badge status-badge--flag">Action needed</span>}
                    </span>
                    {/* which event or booking it is about, or the no-access wording (SCRUM-46/AC7) */}
                    {item.related && <span className="bell-menu__related">{item.related.label}</span>}
                    <span className="bell-menu__time">{formatWhen(item.createdAt)}</span>
                  </button>
                  {/* marks it read without leaving the page, as on the Notifications page */}
                  {!item.isRead && (
                    <button type="button" className="bell-menu__read" onClick={() => markRead(item)}>Mark as read</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {/* the full page also has the technicians' Acknowledge (SCRUM-20) */}
          <Link className="bell-menu__all" href="/notifications">View all notifications</Link>
        </div>
      )}
    </div>
  );
}
