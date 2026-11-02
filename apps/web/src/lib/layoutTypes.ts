import type { LayoutTypeUsage } from "@spm-t5/shared";
import { VENUE_URL, type ApiResult } from "./api";

/** What a layout type call answers: the type, or the reason it was refused (a delete that is refused lists what uses the type). */
export type LayoutTypeReply = { id?: string; name?: string; code?: string; usedBy?: LayoutTypeUsage };

async function call(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<ApiResult<LayoutTypeReply>> {
  try {
    const res = await fetch(`${VENUE_URL}/layout-types${path}`, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } };
  }
}

/** SCRUM-181/AC1: adds a layout type (Venue Staff only; venue-service checks again). */
export const postLayoutType = (name: string) => call("POST", "", { name });

/** SCRUM-181/AC2: renames a layout type. */
export const patchLayoutType = (id: string, name: string) => call("PATCH", `/${encodeURIComponent(id)}`, { name });

/** SCRUM-181/AC3, AC4: deletes a layout type nothing uses; answers 409 LAYOUT_TYPE_IN_USE with `usedBy` when something does. */
export const deleteLayoutType = (id: string) => call("DELETE", `/${encodeURIComponent(id)}`);
