import type { CriterionResult } from "@spm-t5/shared";
import { VENUE_URL, type ApiResult } from "./api";

// Browser-safe types and the call for the venue suitability check (SCRUM-109). The server-side fetch for the
// Venue Staff queue page lives in ./venueSuitabilityServer.

/** GET /venue-suitability: the shared check's report plus the names it was run for. */
export interface SuitabilityView {
  venue: { id: string; name: string };
  event: { id: string; name: string };
  overall: "suitable" | "not_suitable";
  criteria: CriterionResult[];
  manualChecks: string[];
}

/** What to check. The period and attendance are optional; without them the event's own are used. */
export interface SuitabilityQuery {
  venueId: string;
  eventId: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  attendance?: number | null;
  /** The booking's own layout name (SCRUM-98); left out, the event's. */
  venueRequirements?: string;
  /** True where the venue is already held by the very request being looked at (the Venue Staff queue). */
  skipAvailability?: boolean;
}

/** The query string venue-service expects; blank and empty fields are left out. */
export function suitabilityParams(query: SuitabilityQuery): URLSearchParams {
  const params = new URLSearchParams({ venueId: query.venueId, eventId: query.eventId });
  for (const key of ["date", "startTime", "endTime"] as const) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  if (query.attendance != null) params.set("attendance", String(query.attendance));
  if (query.venueRequirements) params.set("venueRequirements", query.venueRequirements);
  if (query.skipAvailability) params.set("skipAvailability", "true");
  return params;
}

/** Asks venue-service from the browser, sending the login cookie. */
export async function checkVenueSuitability(query: SuitabilityQuery): Promise<ApiResult<SuitabilityView>> {
  try {
    const res = await fetch(`${VENUE_URL}/venue-suitability?${suitabilityParams(query).toString()}`, {
      credentials: "include",
      cache: "no-store",
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as ApiResult<SuitabilityView>["data"] };
  }
}
