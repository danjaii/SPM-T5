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

/** SCRUM-46/AC3: "Notifications" with how many are unread when that is known. */
export function notificationsLinkLabel(unread: number | null | undefined): string {
  return typeof unread === "number" ? `Notifications (${unread} unread)` : "Notifications";
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
