import type { AffectedPairDto, VenueTimingInput } from "@spm-t5/shared";
import { VENUE_URL, type ApiResult } from "./api";

/** What a save answers. SCRUM-104: `affected` lists the existing bookings that now clash, `message` says so (or that none do). */
export interface VenueTimingSaved {
  setup_minutes: number;
  turnaround_minutes: number;
  affected: AffectedPairDto[];
  message: string;
}

/** SCRUM-101: saves a venue's setup and turnaround times (Venue Staff only; venue-service checks again). */
export async function putVenueTiming(venueId: string, body: VenueTimingInput): Promise<ApiResult<VenueTimingSaved>> {
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
