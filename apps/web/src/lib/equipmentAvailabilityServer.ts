import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_EQUIPMENT_URL, SESSION_COOKIE } from "./api";
import type { EquipmentOption } from "./equipmentAvailability";

// Server-only: reads equipment-service with the login cookie via next/headers. Client components must not
// import this file; the browser-safe types live in ./equipmentAvailability.

/**
 * SCRUM-18: the catalogue names for the form's suggestions. Anyone not signed in goes to the sign-in page;
 * any role but Technical Support Staff gets the service's 403 message.
 */
export async function getEquipmentOptions(): Promise<{ equipment: EquipmentOption[] } | { error: string }> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  let res: Response;
  try {
    res = await fetch(`${SERVER_EQUIPMENT_URL}/equipment`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
  } catch {
    return { error: "We couldn't reach the equipment service. Please try again." };
  }
  if (res.status === 401) redirect("/login");

  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { error: (body as { error?: string }).error ?? "Something went wrong. Please try again." };
  return { equipment: body as EquipmentOption[] };
}
