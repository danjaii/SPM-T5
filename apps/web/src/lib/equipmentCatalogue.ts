import type { EquipmentInput } from "@spm-t5/shared";
import { EQUIPMENT_URL, type ApiResult } from "./api";

/** What an equipment catalogue call answers: the item's id, or the reason it was refused. */
export type EquipmentCatalogueReply = { id?: string; code?: string };

async function call(method: "POST" | "PUT", path: string, body: unknown): Promise<ApiResult<EquipmentCatalogueReply>> {
  try {
    const res = await fetch(`${EQUIPMENT_URL}/equipment-catalogue${path}`, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } };
  }
}

/** SCRUM-182/AC1: adds an item (Technical Support Staff only; equipment-service checks again). It always starts available. */
export const postEquipment = (body: Omit<EquipmentInput, "operationalStatus">) => call("POST", "", body);

/** SCRUM-182/AC2, AC3: saves an edited item, including its operational status. */
export const putEquipment = (id: string, body: EquipmentInput) => call("PUT", `/${encodeURIComponent(id)}`, body);
