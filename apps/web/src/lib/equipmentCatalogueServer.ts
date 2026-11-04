import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { canManageEquipmentCatalogue, type EquipmentCatalogueItem } from "@spm-t5/shared";
import { SERVER_EQUIPMENT_URL, SESSION_COOKIE } from "./api";
import { getShellData } from "./shellServer";

// Server-only: reads the signed-in user through the app shell's helper, which never redirects.

/** SCRUM-182/AC5: whether to offer the catalogue actions. The service and the database refuse everyone else regardless. */
export async function canManageCatalogue(): Promise<boolean> {
  const shell = await getShellData();
  return shell !== null && canManageEquipmentCatalogue(shell.user.role);
}

/**
 * SCRUM-182: every catalogue item with its details. Anyone not signed in goes to the sign-in page; a role that may not manage
 * the catalogue gets the service's own reason.
 */
export async function getEquipmentCatalogue(): Promise<{ items: EquipmentCatalogueItem[] } | { error: string }> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  let res: Response;
  try {
    res = await fetch(`${SERVER_EQUIPMENT_URL}/equipment-catalogue`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
  } catch {
    return { error: "We couldn't reach the equipment service. Please try again." };
  }
  if (res.status === 401) redirect("/login");

  const body = await res.json().catch(() => ({}));
  return res.ok ? { items: body as EquipmentCatalogueItem[] } : { error: (body as { error?: string }).error ?? "We couldn't load the equipment catalogue." };
}
