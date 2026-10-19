import type { UnavailabilityBlockView } from "@spm-t5/shared";
import { VENUE_URL, type ApiResult } from "./api";

/** What the form sends: Singapore dates and times as typed, and the chosen reason (SCRUM-105). */
export interface UnavailabilityBody {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  reason: string;
  notes?: string;
}

/** SCRUM-105: marks a venue unavailable (Venue Staff only; venue-service checks again, and so does the database). */
export async function postVenueUnavailability(venueId: string, body: UnavailabilityBody): Promise<ApiResult<{ block: UnavailabilityBlockView; affectedBookings?: number; message?: string }>> {
  try {
    const res = await fetch(`${VENUE_URL}/venues/${encodeURIComponent(venueId)}/unavailability`, {
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
