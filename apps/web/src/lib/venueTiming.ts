import type { VenueTimingInput } from "@spm-t5/shared";
import { VENUE_URL, type ApiResult } from "./api";

/** SCRUM-101: saves a venue's setup and turnaround times (Venue Staff only; venue-service checks again). */
export async function putVenueTiming(
  venueId: string,
  body: VenueTimingInput,
): Promise<ApiResult<{ setup_minutes: number; turnaround_minutes: number }>> {
  try {
    const res = await fetch(`${VENUE_URL}/venues/${encodeURIComponent(venueId)}/timing`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as never };
  }
}
