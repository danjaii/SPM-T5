import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@spm-t5/shared";
import type { DashboardData } from "@/components/DashboardView";
import { SERVER_AUTH_URL, SESSION_COOKIE } from "./api";

/**
 * Loads the signed-in user's dashboard data from auth-service. auth-service decides what this role may
 * see; middleware.ts has already checked the session and that the URL matches the role.
 */
export async function getDashboard(expectedRole: Role): Promise<DashboardData> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  const res = await fetch(`${SERVER_AUTH_URL}/dashboard`, {
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login");
  if (!res.ok) throw new Error("Could not load the dashboard");

  const data = (await res.json()) as DashboardData;
  // Backstop for the route guard: never show one role's page to another role.
  if (data.user.role !== expectedRole) redirect(`/dashboard/${data.user.role}`);
  return data;
}
