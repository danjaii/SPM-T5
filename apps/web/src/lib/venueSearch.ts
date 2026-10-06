import { VENUE_URL, type ApiResult } from "./api";

// Browser-safe types and the call for the venue search (SCRUM-65). The server-side fetch of the layout and
// facility choices lives in ./venueSearchServer.

/** One venue in the results (AC7). */
export interface VenueSearchResultView {
  id: string;
  name: string;
  address: string;
  max_capacity: number;
  is_accessible: boolean;
  accessibility_notes: string | null;
  layouts: { id: string; name: string; max_capacity: number }[];
  facilities: { id: string; name: string }[];
}

/** GET /venues/search-options: the choices the form offers. */
export interface VenueSearchOptions {
  layouts: { id: string; name: string }[];
  facilities: { id: string; name: string }[];
}

/** The form's fields exactly as typed; venue-service checks them again. */
export interface VenueSearchQuery {
  date: string;
  startTime: string;
  endTime: string;
  attendance: string;
  location: string;
  layoutId: string;
  accessible: boolean;
  facilityIds: string[];
}

/** Asks venue-service from the browser, sending the login cookie. Only filled-in filters are sent. */
export async function searchVenues(query: VenueSearchQuery): Promise<ApiResult<{ venues: VenueSearchResultView[] }>> {
  const params = new URLSearchParams({ date: query.date, startTime: query.startTime, endTime: query.endTime });
  if (query.attendance.trim()) params.set("attendance", query.attendance.trim());
  if (query.location.trim()) params.set("location", query.location.trim());
  if (query.layoutId) params.set("layoutId", query.layoutId);
  if (query.accessible) params.set("accessible", "true");
  if (query.facilityIds.length > 0) params.set("facilityIds", query.facilityIds.join(","));

  try {
    const res = await fetch(`${VENUE_URL}/venues/search?${params.toString()}`, { credentials: "include", cache: "no-store" });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return {
      ok: false,
      data: { error: "We couldn't reach the server. Please try again." } as ApiResult<{ venues: VenueSearchResultView[] }>["data"],
    };
  }
}
