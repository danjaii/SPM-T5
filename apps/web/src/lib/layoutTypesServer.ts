import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { canManageVenueCatalogue, type LayoutTypeView } from "@spm-t5/shared";
import { SERVER_VENUE_URL, SESSION_COOKIE } from "./api";
import { getShellData } from "./shellServer";

// Server-only: reads the signed-in user through the app shell's helper, which never redirects.

/** SCRUM-181/AC6: whether to offer the layout type actions. The service and the database refuse everyone else regardless. */
export async function canManageLayoutTypes(): Promise<boolean> {
  const shell = await getShellData();
  return shell !== null && canManageVenueCatalogue(shell.user.role);
}

/**
 * SCRUM-181: every layout type with the number of venues that support it. Anyone not signed in goes to the sign-in page; a
 * role that may not manage layout types gets the service's own reason.
 */
export async function getLayoutTypes(): Promise<{ layoutTypes: LayoutTypeView[] } | { error: string }> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  let res: Response;
  try {
    res = await fetch(`${SERVER_VENUE_URL}/layout-types`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
  } catch {
    return { error: "We couldn't reach the venue service. Please try again." };
  }
  if (res.status === 401) redirect("/login");

  const body = await res.json().catch(() => ({}));
  return res.ok ? { layoutTypes: body as LayoutTypeView[] } : { error: (body as { error?: string }).error ?? "We couldn't load the layout types." };
}
