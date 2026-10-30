import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { canManageVenueCatalogue, type VenueInput } from "@spm-t5/shared";
import { SERVER_VENUE_URL, SESSION_COOKIE } from "./api";
import { getShellData } from "./shellServer";

// Server-only: reads the signed-in user through the app shell's helper, which never redirects.

/** SCRUM-57/AC3: whether to offer the add-a-venue action. The service and the database refuse everyone else regardless. */
export async function canAddVenue(): Promise<boolean> {
  const shell = await getShellData();
  return shell !== null && canManageVenueCatalogue(shell.user.role);
}

/** SCRUM-58/AC3: whether to offer the edit action. The service and the database refuse everyone else regardless. */
export async function canEditVenue(): Promise<boolean> {
  return canAddVenue();
}

/**
 * SCRUM-58: one venue as the edit form needs it (layout and facility ids). Anyone not signed in goes to the sign-in page; a
 * role that may not edit, or an unknown venue, gets the service's own reason.
 */
export async function getVenueForEdit(id: string): Promise<{ venue: VenueInput } | { error: string }> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  let res: Response;
  try {
    res = await fetch(`${SERVER_VENUE_URL}/venues/${encodeURIComponent(id)}/edit`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
  } catch {
    return { error: "We couldn't reach the venue service. Please try again." };
  }
  if (res.status === 401) redirect("/login");

  const body = await res.json().catch(() => ({}));
  return res.ok ? { venue: body as VenueInput } : { error: (body as { error?: string }).error ?? "We couldn't load this venue." };
}
