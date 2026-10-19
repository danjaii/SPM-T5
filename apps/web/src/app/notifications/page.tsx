import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { NotificationList } from "@/components/NotificationList";
import { getNotifications } from "@/lib/notificationsServer";

// Rendered per request: what's shown depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Notifications · ConnectSphere" };

// SCRUM-46: every signed-in user's own notifications.
export default async function NotificationsPage() {
  const result = await getNotifications();

  return (
    <>
      <AppHeader />
      <main className="dash__main">
        <Link className="back-link" href="/dashboard">← Back to dashboard</Link>
        <h1>Notifications</h1>
        {"items" in result ? (
          <NotificationList items={result.items} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
