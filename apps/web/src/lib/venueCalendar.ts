import { utcToSgt } from "@spm-t5/shared";
import { VENUE_URL } from "@/lib/api";

// Browser-side types and fetch for the venue availability calendar (SCRUM-84; contract: GET /venue-calendar on venue-service).
// All instants are UTC ISO strings; the field names are snake_case, as the service sends them.

export type CalendarStatus = "TENTATIVELY_HELD" | "CONFIRMED" | "BLOCKED" | "AVAILABLE" | "UNAVAILABLE";
export type CalendarPeriodKind = "event" | "setup" | "turnaround" | "block" | "open" | "closed";

/** One stretch of a venue's time. Fields the page does not know are ignored (SCRUM-85 adds more). */
export interface CalendarPeriod {
  kind: CalendarPeriodKind;
  status: CalendarStatus;
  /** The exact text to show: "Tentatively Held", "Confirmed", "Blocked", "Available" or "Unavailable". */
  label: string;
  start: string;
  end: string;
  /** Only on a block. */
  reason?: string;
  reason_label?: string;
  overlaps_confirmed_booking?: boolean;
}

export interface CalendarVenue {
  id: string;
  name: string;
  address: string;
  max_capacity: number;
  operating_hours: { start: string; end: string } | null;
  setup_minutes: number;
  turnaround_minutes: number;
  periods: CalendarPeriod[];
}

export interface VenueCalendarData {
  range: { from: string; to: string; start: string; end: string; time_zone: string };
  venues: CalendarVenue[];
}

/** The dates asked for (Singapore days, both inclusive). Nothing asked for is the current week. */
export interface CalendarQuery {
  from?: string;
  to?: string;
}

export type CalendarResult =
  | { kind: "ok"; calendar: VenueCalendarData }
  | { kind: "invalid"; fieldErrors: Record<string, string> }
  | { kind: "unauthenticated" }
  | { kind: "forbidden"; message: string }
  | { kind: "error"; message: string };

/** GET /venue-calendar with the login cookie. Never cached, so a reload always shows the latest holds, bookings and blocks (AC7). */
export async function fetchVenueCalendar(query: CalendarQuery = {}, signal?: AbortSignal): Promise<CalendarResult> {
  const params = new URLSearchParams();
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  const search = params.toString();

  let res: Response;
  try {
    res = await fetch(`${VENUE_URL}/venue-calendar${search ? `?${search}` : ""}`, { credentials: "include", cache: "no-store", signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { kind: "error", message: "We couldn't reach the venue service. Please try again." };
  }

  const body = await res.json().catch(() => ({}));
  if (res.ok) return { kind: "ok", calendar: body as VenueCalendarData };
  if (res.status === 401) return { kind: "unauthenticated" };
  if (res.status === 403) return { kind: "forbidden", message: body.error ?? "You are not allowed to view the venue calendar." };
  if (res.status === 422 && body.fieldErrors) return { kind: "invalid", fieldErrors: body.fieldErrors };
  return { kind: "error", message: body.error ?? "Something went wrong. Please try again." };
}

/** "2026-11-14 10:00 to 12:00" in Singapore time; the end carries its date too when it falls on another day. */
export function formatPeriodTimes(startIso: string, endIso: string): string {
  const start = utcToSgt(new Date(startIso));
  const end = utcToSgt(new Date(endIso));
  return `${start.date} ${start.time} to ${end.date === start.date ? end.time : `${end.date} ${end.time}`}`;
}
