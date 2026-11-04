// SCRUM-181 (docs/specs/layout-type-maintenance.md): Venue Staff add, rename and delete room layout types. The checks live
// here so the page and venue-service use the very same code and can never disagree. Who may manage layout types is
// canManageVenueCatalogue (venueCatalogue.ts): Venue Staff only.

/** A typo guard (ours; the seeded names are 7 to 10 characters). The database holds the same limit. */
export const LAYOUT_TYPE_NAME_MAX_LENGTH = 60;

export interface LayoutTypeInput {
  name: string;
}

export type ParsedLayoutTypeInput = { ok: true; data: LayoutTypeInput } | { ok: false; fieldErrors: { name: string } };

/** 181-S5: the name as it is stored: trimmed, with every run of white space made one space. */
export function cleanLayoutTypeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** 181-S5: checks a request body. An empty name, or one over the limit, is refused with the reason for the `name` field. */
export function parseLayoutTypeInput(body: unknown): ParsedLayoutTypeInput {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>).name : undefined;
  const name = typeof raw === "string" ? cleanLayoutTypeName(raw) : "";
  if (name === "") return { ok: false, fieldErrors: { name: "Enter a name for the layout type." } };
  if (name.length > LAYOUT_TYPE_NAME_MAX_LENGTH) {
    return { ok: false, fieldErrors: { name: `The name can be at most ${LAYOUT_TYPE_NAME_MAX_LENGTH} characters.` } };
  }
  return { ok: true, data: { name } };
}

/** 181-S5: two names are the same layout type when they match ignoring case and spacing ("theatre" and " Theatre "). */
export function sameLayoutName(a: string, b: string): boolean {
  return cleanLayoutTypeName(a).toLowerCase() === cleanLayoutTypeName(b).toLowerCase();
}

/** A layout type as the Layout types page lists it. `venueCount` counts venues only; event requests that prefer it are not counted. */
export interface LayoutTypeView {
  id: string;
  name: string;
  isActive: boolean;
  venueCount: number;
}

/** What uses a layout type that cannot be deleted: its venues (named) and how many event requests prefer it (never named). */
export interface LayoutTypeUsage {
  venues: { id: string; name: string }[];
  eventCount: number;
}

/**
 * 181-S4: the sentence Venue Staff are told when a delete is refused. Venues are named. Event requests, drafts included, are
 * only counted, because Venue Staff may not read them. The page and the service use this one function.
 */
export function layoutTypeInUseMessage(name: string, usage: LayoutTypeUsage): string {
  const parts: string[] = [];
  const venueCount = usage.venues.length;
  if (venueCount > 0) {
    parts.push(`${venueCount} ${venueCount === 1 ? "venue uses" : "venues use"} it: ${usage.venues.map((v) => v.name).join(", ")}`);
  }
  if (usage.eventCount > 0) {
    parts.push(`${usage.eventCount} ${usage.eventCount === 1 ? "event request prefers" : "event requests prefer"} it`);
  }
  return `"${name}" cannot be deleted because ${parts.join(", and ")}.`;
}
