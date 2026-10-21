import { checkSuitability, sgtToUtc, type CriterionStatus } from "@spm-t5/shared";
import type { VenueSearchOptions, VenueSearchQuery, VenueSearchResultView } from "./venueSearch";

// SCRUM-132: the per-requirement checks on a venue result card. Capacity, layout and operating hours are judged by the
// shared checkSuitability (SCRUM-109), so a card and the booking request agree; accessibility and facilities are the
// search filters, judged against what the result carries. The search only returns venues that are free for the period,
// so availability is met whenever a period was searched.

export interface VenueCheck {
  key: string;
  met: boolean;
  /** What the coordinator reads, e.g. "Capacity 120 / need 150". */
  label: string;
}

export interface VenueChecks {
  overall: "suitable" | "not_suitable";
  checks: VenueCheck[];
}

/** Only the requirements the coordinator set are listed; a venue is Suitable when none of them is missed. */
export function venueChecks(venue: VenueSearchResultView, query: VenueSearchQuery, options: VenueSearchOptions): VenueChecks {
  const attendance = /^\d+$/.test(query.attendance.trim()) ? Number(query.attendance.trim()) : null;
  const layoutName = options.layouts.find((l) => l.id === query.layoutId)?.name ?? null;
  const hasPeriod = query.startDate !== "" && query.endDate !== "";
  const report = checkSuitability(
    {
      name: venue.name,
      maxCapacity: venue.max_capacity,
      openingTime: venue.opening_time,
      closingTime: venue.closing_time,
      isAccessible: venue.is_accessible,
      accessibilityNotes: venue.accessibility_notes,
      layouts: venue.layouts.map((l) => ({ name: l.name, maxCapacity: l.max_capacity })),
    },
    {
      attendance,
      layoutName,
      accessibilityNeeds: null,
      start: hasPeriod ? sgtToUtc(query.startDate, query.startTime) : null,
      end: hasPeriod ? sgtToUtc(query.endDate, query.endTime) : null,
    },
    hasPeriod ? { conflict: null } : null,
  );
  const status = (key: string): CriterionStatus | undefined => report.criteria.find((c) => c.key === key)?.status;

  const checks: VenueCheck[] = [];
  if (attendance !== null) {
    const layout = venue.layouts.find((l) => l.name === layoutName);
    checks.push({ key: "capacity", met: status("capacity") === "met", label: `Capacity ${layout?.max_capacity ?? venue.max_capacity} / need ${attendance}` });
  }
  if (layoutName) {
    const met = status("layout") === "met";
    checks.push({ key: "layout", met, label: met ? `${layoutName} layout` : `No ${layoutName} layout` });
  }
  if (hasPeriod) {
    const hours = venue.opening_time && venue.closing_time ? `${venue.opening_time}–${venue.closing_time}` : "";
    const met = status("operatingHours") === "met";
    checks.push({ key: "hours", met, label: met ? (hours ? `Open ${hours}` : "No stated opening hours") : `Closed outside ${hours}` });
    checks.push({ key: "free", met: status("availability") === "met", label: "Free for the whole period" });
  }
  if (query.accessible) checks.push({ key: "accessible", met: venue.is_accessible, label: venue.is_accessible ? "Accessible" : "Not accessible" });
  for (const id of query.facilityIds) {
    const name = options.facilities.find((f) => f.id === id)?.name ?? id;
    const met = venue.facilities.some((f) => f.id === id);
    checks.push({ key: `facility:${id}`, met, label: met ? name : `No ${name}` });
  }
  return { overall: checks.every((c) => c.met) ? "suitable" : "not_suitable", checks };
}
