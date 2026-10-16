import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@spm-t5/shared";
import type { DashboardData } from "@/components/DashboardView";
import { SERVER_AUTH_URL, SESSION_COOKIE } from "./api";
import { getUnreadCount } from "./notificationsServer";

/**
 * Loads the signed-in user's dashboard data from auth-service. auth-service decides what this role may
 * see; middleware.ts has already checked the session and that the URL matches the role.
 */
export async function getDashboard(expectedRole: Role): Promise<DashboardData> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  // SCRUM-46: the unread count comes from notification-service, fetched alongside the dashboard (null if it is down)
  const [res, unread] = await Promise.all([
    fetch(`${SERVER_AUTH_URL}/dashboard`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    }),
    getUnreadCount(),
  ]);
  if (res.status === 401) redirect("/login");
  if (!res.ok) throw new Error("Could not load the dashboard");

  const data = { ...((await res.json()) as DashboardData), notifications: { unread } };
  // Backstop for the route guard: never show one role's page to another role.
  if (data.user.role !== expectedRole) redirect(`/dashboard/${data.user.role}`);
  return data;
}
