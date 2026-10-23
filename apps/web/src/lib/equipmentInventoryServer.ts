import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_EQUIPMENT_URL, SESSION_COOKIE } from "./api";
import type { InventoryItemView, InventoryPeriodQuery } from "./equipmentInventory";

// Server-only: reads equipment-service with the login cookie via next/headers. Client components must not
// import this file; the browser-safe types live in ./equipmentInventory.

export type InventoryResult = { items: InventoryItemView[] } | { fieldErrors: Record<string, string> } | { error: string };

/**
 * SCRUM-137/AC2: the inventory for a period. Anyone not signed in goes to the sign-in page; a period equipment-service
 * refuses comes back as its field messages; any role but Technical Support Staff gets the service's 403 message.
 */
export async function getEquipmentInventory(period: InventoryPeriodQuery): Promise<InventoryResult> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  let res: Response;
  try {
    res = await fetch(`${SERVER_EQUIPMENT_URL}/equipment-inventory?${new URLSearchParams({ ...period }).toString()}`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
  } catch {
    return { error: "We couldn't reach the equipment service. Please try again." };
  }
  if (res.status === 401) redirect("/login");

  const body = await res.json().catch(() => ({}));
  if (res.status === 422 && (body as { fieldErrors?: Record<string, string> }).fieldErrors) {
    return { fieldErrors: (body as { fieldErrors: Record<string, string> }).fieldErrors };
  }
  if (!res.ok) return { error: (body as { error?: string }).error ?? "Something went wrong. Please try again." };
  return { items: body as InventoryItemView[] };
}
