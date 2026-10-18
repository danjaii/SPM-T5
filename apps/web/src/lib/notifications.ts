import type { NotificationItem } from "@spm-t5/shared";
import { NOTIFICATION_URL, type ApiResult } from "./api";

/** SCRUM-46/AC4: marks one notification read, from the browser, with the session cookie. Safe to repeat. */
export async function markNotificationRead(id: string): Promise<ApiResult<NotificationItem>> {
  try {
    const res = await fetch(`${NOTIFICATION_URL}/notifications/${encodeURIComponent(id)}/read`, {
      method: "POST",
      credentials: "include",
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as never };
  }
}

/** SCRUM-47/AC11: how many notifications are unread, for the header bell. Null on any failure: the bell then has no number. */
export async function fetchUnreadCount(): Promise<number | null> {
  try {
    const res = await fetch(`${NOTIFICATION_URL}/notifications/unread-count`, { credentials: "include" });
    if (!res.ok) return null;
    const body = (await res.json()) as { unreadCount?: unknown };
    return typeof body.unreadCount === "number" ? body.unreadCount : null;
  } catch {
    return null;
  }
}

/** SCRUM-47/AC11: the signed-in user's notifications, newest first, for the header bell's list. */
export async function fetchNotifications(): Promise<ApiResult<{ items: NotificationItem[]; unreadCount: number }>> {
  try {
    const res = await fetch(`${NOTIFICATION_URL}/notifications`, { credentials: "include" });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as never };
  }
}

/** SCRUM-20/AC4, AC5: acknowledges an on-site assignment notification; answers with it read and acknowledged. */
export async function acknowledgeNotification(id: string): Promise<ApiResult<NotificationItem>> {
  try {
    const res = await fetch(`${NOTIFICATION_URL}/notifications/${encodeURIComponent(id)}/acknowledge`, {
      method: "POST",
      credentials: "include",
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as never };
  }
}
