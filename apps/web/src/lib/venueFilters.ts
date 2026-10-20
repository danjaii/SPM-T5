import { utcToSgt } from "@spm-t5/shared";
import type { EventDetailView } from "./events";
import type { VenueSearchOptions, VenueSearchQuery } from "./venueSearch";

// SCRUM-131: pure helpers behind the filters on the venue catalogue — the starting query, a query taken from an
// event (AC1), the chips for the active filters (AC2) and the hint for an empty result (AC3).

export const emptyVenueQuery: VenueSearchQuery = {
  startDate: "",
  startTime: "09:00",
  endDate: "",
  endTime: "17:00",
  attendance: "",
  location: "",
  layoutId: "",
  accessible: false,
  facilityIds: [],
};

/** SCRUM-131/AC1: the event's date, time, attendance and requirements as filters. Anything the event doesn't state stays empty. */
export function queryFromEvent(event: EventDetailView, options: VenueSearchOptions): VenueSearchQuery {
  const start = event.preferred_start_datetime ? utcToSgt(new Date(event.preferred_start_datetime)) : undefined;
  const end = event.preferred_end_datetime ? utcToSgt(new Date(event.preferred_end_datetime)) : undefined;
  const layout = options.layouts.find((l) => l.name.toLowerCase() === event.preferred_layout_name?.toLowerCase());
  return {
    ...emptyVenueQuery,
    startDate: start?.date ?? "",
    startTime: start?.time ?? emptyVenueQuery.startTime,
    endDate: end?.date ?? start?.date ?? "",
    endTime: end?.time ?? emptyVenueQuery.endTime,
    attendance: event.expected_attendance ? String(event.expected_attendance) : "",
    layoutId: layout?.id ?? "",
    accessible: Boolean(event.accessibility_requirements?.trim()),
  };
}

/** One active filter, shown as a removable chip. `key` says what removing it clears. */
export interface FilterChip {
  key: string;
  label: string;
}

/** SCRUM-131/AC2: a chip for each filter that is in use. The period is one chip: a search needs it. */
export function filterChips(query: VenueSearchQuery, options: VenueSearchOptions): FilterChip[] {
  const chips: FilterChip[] = [];
  const dates = query.endDate && query.endDate !== query.startDate ? `${query.startDate} to ${query.endDate}` : query.startDate;
  if (query.startDate) chips.push({ key: "period", label: `${dates}, ${query.startTime}–${query.endTime}` });
  if (query.attendance.trim()) chips.push({ key: "attendance", label: `${query.attendance.trim()} people` });
  if (query.location.trim()) chips.push({ key: "location", label: `Location: ${query.location.trim()}` });
  const layout = options.layouts.find((l) => l.id === query.layoutId);
  if (layout) chips.push({ key: "layout", label: `Layout: ${layout.name}` });
  if (query.accessible) chips.push({ key: "accessible", label: "Accessible" });
  for (const id of query.facilityIds) {
    const facility = options.facilities.find((f) => f.id === id);
    if (facility) chips.push({ key: `facility:${id}`, label: facility.name });
  }
  return chips;
}

/** What removing a chip does to the query. Removing the period leaves nothing to search for. */
export function withoutFilter(query: VenueSearchQuery, key: string): VenueSearchQuery {
  if (key === "period") return { ...query, startDate: "", endDate: "" };
  if (key === "attendance") return { ...query, attendance: "" };
  if (key === "location") return { ...query, location: "" };
  if (key === "layout") return { ...query, layoutId: "" };
  if (key === "accessible") return { ...query, accessible: false };
  if (key.startsWith("facility:")) return { ...query, facilityIds: query.facilityIds.filter((id) => `facility:${id}` !== key) };
  return query;
}

/** SCRUM-131/AC3: which filters to relax when nothing matched — the optional ones in use, or the period if there are none. */
export function relaxHint(query: VenueSearchQuery): string {
  const optional: string[] = [];
  if (query.facilityIds.length > 0) optional.push("required facilities");
  if (query.layoutId) optional.push("layout");
  if (query.accessible) optional.push("accessibility");
  if (query.attendance.trim()) optional.push("attendance");
  if (query.location.trim()) optional.push("location");
  if (optional.length === 0) return "No venue is free for this date and time. Try a different date or time.";
  return `No venue matches every filter. Try relaxing: ${optional.join(", ")}.`;
}
