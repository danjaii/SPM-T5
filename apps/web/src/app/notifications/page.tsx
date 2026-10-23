import type { Metadata } from "next";
import { AuthAlert } from "@/components/auth/AuthParts";
import { NotificationList } from "@/components/NotificationList";
import { getNotifications } from "@/lib/notificationsServer";

// Rendered per request: what's shown depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Notifications · ConnectSphere" };

// SCRUM-46: every signed-in user's own notifications. SCRUM-141: inside the shared app shell, which has the way back.
export default async function NotificationsPage() {
  const result = await getNotifications();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
      <h1 className="mb-1 text-3xl font-bold tracking-tight text-foreground">Notifications</h1>
      <p className="mb-6 text-sm text-muted-foreground">Open one to mark it read and go to where you can act on it.</p>
      {"items" in result ? <NotificationList items={result.items} /> : <AuthAlert tone="error">{result.error}</AuthAlert>}
    </main>
  );
}
