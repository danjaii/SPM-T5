import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NotificationItem } from "@spm-t5/shared";
import { SERVER_NOTIFICATION_URL, SESSION_COOKIE } from "./api";

// Server-only: reads notification-service with the session cookie via next/headers. Client components must not
// import this file; the browser-side helper (markNotificationRead) is in ./notifications.

/** SCRUM-46/AC1: the signed-in user's notifications, newest first; anyone not signed in goes to the sign-in page. */
export async function getNotifications(): Promise<{ items: NotificationItem[]; unreadCount: number } | { error: string }> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  let res: Response;
  try {
    res = await fetch(`${SERVER_NOTIFICATION_URL}/notifications`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
  } catch {
    return { error: "We couldn't load your notifications. Please try again." };
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) return { error: "We couldn't load your notifications. Please try again." };
  return (await res.json()) as { items: NotificationItem[]; unreadCount: number };
}

/**
 * SCRUM-46: how many notifications are unread, for the dashboard link. Null on any failure, so a service that is down
 * never breaks the dashboard: the link just shows without a count.
 */
export async function getUnreadCount(): Promise<number | null> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const res = await fetch(`${SERVER_NOTIFICATION_URL}/notifications/unread-count`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { unreadCount?: unknown };
    return typeof body.unreadCount === "number" ? body.unreadCount : null;
  } catch {
    return null;
  }
}
