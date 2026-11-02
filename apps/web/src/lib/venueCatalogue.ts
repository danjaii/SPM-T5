import type { VenueInput } from "@spm-t5/shared";
import { VENUE_URL, type ApiResult } from "./api";

/** SCRUM-57: adds a venue to the catalogue (Venue Staff only; venue-service checks again). Answers with the new venue's id. */
export async function postVenue(body: VenueInput): Promise<ApiResult<{ id: string }>> {
  try {
    const res = await fetch(`${VENUE_URL}/venues`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as never };
  }
}
