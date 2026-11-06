import type { Metadata } from "next";
import { NotificationList } from "@/components/NotificationList";
import { PageFrame } from "@/components/PageFrame";
import { getNotifications } from "@/lib/notificationsServer";

// Rendered per request: what's shown depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Notifications · ConnectSphere" };

// SCRUM-46: every signed-in user's own notifications. SCRUM-141: inside the shared app shell, which has the way back.
// SCRUM-186/AC1, AC5: the shared page frame.
export default async function NotificationsPage() {
  const result = await getNotifications();

  return (
    <PageFrame
      title="Notifications"
      description="Open one to mark it read and go to where you can act on it."
      error={"items" in result ? undefined : result.error}
    >
      {"items" in result && <NotificationList items={result.items} />}
    </PageFrame>
  );
}
