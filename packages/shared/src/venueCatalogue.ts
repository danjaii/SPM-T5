import type { Role } from "./roles";

// SCRUM-57 (docs/specs/venue-add.md): adding a venue to the catalogue. The checks live here so the add form and
// venue-service use the very same code and can never disagree.

export const VENUE_NAME_MAX_LENGTH = 120;
export const VENUE_ADDRESS_MAX_LENGTH = 200;
/** A typo guard (the Jira story only says the capacity is a positive number). */
export const VENUE_CAPACITY_MAX = 100000;

/** 57-S3: only Venue Staff may add a venue; coordinators browse the catalogue read-only. */
export function canManageVenueCatalogue(role: Role): boolean {
  return role === "venue_staff";
}

export interface VenueLayoutInput {
  layoutId: string;
  maxCapacity: number;
}

export interface VenueInput {
  name: string;
  address: string;
  description: string | null;
  maxCapacity: number;
  /** "HH:MM", both set or both null. */
  operatingHoursStart: string | null;
  operatingHoursEnd: string | null;
  isAccessible: boolean;
  accessibilityNotes: string | null;
  layouts: VenueLayoutInput[];
  facilityIds: string[];
}

export type VenueInputField =
  | "name"
  | "address"
  | "description"
  | "maxCapacity"
  | "operatingHoursStart"
  | "operatingHoursEnd"
  | "isAccessible"
  | "accessibilityNotes"
  | "layouts"
  | "facilityIds";

export type ParsedVenueInput =
  | { ok: true; data: VenueInput }
  | { ok: false; fieldErrors: Partial<Record<VenueInputField, string>> };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

/** A whole number from 1 to the limit, given as a number or a numeric string; null for anything else. */
function wholeNumber(value: unknown, max: number): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= max ? n : null;
}

/** Trimmed text, or "" when it is not a string. */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Postgres returns time columns as "HH:MM:SS"; the form works in "HH:MM". */
function clock(value: unknown): { given: boolean; time: string | null } {
  const t = text(value);
  if (t === "") return { given: false, time: null };
  const m = TIME.exec(t);
  return { given: true, time: m ? `${m[1]}:${m[2]}` : null };
}

/** 57-S1/S2: checks every field together, so the form can show every problem at once. */
export function parseVenueInput(body: unknown): ParsedVenueInput {
  const input = (body !== null && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const fieldErrors: Partial<Record<VenueInputField, string>> = {};

  const name = text(input.name);
  if (name === "") fieldErrors.name = "Enter the venue's name.";
  else if (name.length > VENUE_NAME_MAX_LENGTH) fieldErrors.name = `The name can be at most ${VENUE_NAME_MAX_LENGTH} characters.`;

  const address = text(input.address);
  if (address === "") fieldErrors.address = "Enter the venue's location.";
  else if (address.length > VENUE_ADDRESS_MAX_LENGTH) fieldErrors.address = `The location can be at most ${VENUE_ADDRESS_MAX_LENGTH} characters.`;

  const maxCapacity = wholeNumber(input.maxCapacity, VENUE_CAPACITY_MAX);
  if (maxCapacity === null) fieldErrors.maxCapacity = `Capacity must be a whole number from 1 to ${VENUE_CAPACITY_MAX}.`;

  const start = clock(input.operatingHoursStart);
  const end = clock(input.operatingHoursEnd);
  if (start.given && start.time === null) fieldErrors.operatingHoursStart = "Enter the opening time as HH:MM.";
  if (end.given && end.time === null) fieldErrors.operatingHoursEnd = "Enter the closing time as HH:MM.";
  if (start.given !== end.given) {
    if (start.given) fieldErrors.operatingHoursEnd ??= "Enter a closing time as well, or clear the opening time.";
    else fieldErrors.operatingHoursStart ??= "Enter an opening time as well, or clear the closing time.";
  } else if (start.time && end.time && start.time >= end.time) {
    fieldErrors.operatingHoursEnd = "The closing time must be after the opening time.";
  }

  let isAccessible = false;
  if (typeof input.isAccessible === "boolean") isAccessible = input.isAccessible;
  else if (input.isAccessible !== undefined && input.isAccessible !== null) fieldErrors.isAccessible = "Say whether the venue is accessible: yes or no.";

  const layouts: VenueLayoutInput[] = [];
  if (!Array.isArray(input.layouts) || input.layouts.length === 0) {
    fieldErrors.layouts = "Choose at least one supported layout.";
  } else {
    const seen = new Set<string>();
    for (const raw of input.layouts) {
      const row = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const layoutId = text(row.layoutId);
      const capacity = wholeNumber(row.maxCapacity, VENUE_CAPACITY_MAX);
      if (!ID.test(layoutId)) {
        fieldErrors.layouts ??= "Choose each layout from the list.";
      } else if (seen.has(layoutId)) {
        fieldErrors.layouts ??= "Each layout can only be listed once.";
      } else if (capacity === null) {
        fieldErrors.layouts ??= "Each layout's capacity must be a whole number of at least 1.";
      } else if (maxCapacity !== null && capacity > maxCapacity) {
        fieldErrors.layouts ??= `A layout cannot seat more than the venue's capacity of ${maxCapacity}.`;
      } else {
        layouts.push({ layoutId, maxCapacity: capacity });
      }
      seen.add(layoutId);
    }
  }

  const facilityIds: string[] = [];
  if (input.facilityIds !== undefined && input.facilityIds !== null) {
    if (!Array.isArray(input.facilityIds) || input.facilityIds.some((f) => !ID.test(text(f)))) {
      fieldErrors.facilityIds = "Choose each facility from the list.";
    } else {
      for (const f of input.facilityIds) if (!facilityIds.includes(text(f))) facilityIds.push(text(f));
    }
  }

  if (Object.keys(fieldErrors).length > 0 || maxCapacity === null) return { ok: false, fieldErrors };
  return {
    ok: true,
    data: {
      name,
      address,
      description: text(input.description) || null,
      maxCapacity,
      operatingHoursStart: start.time,
      operatingHoursEnd: end.time,
      isAccessible,
      accessibilityNotes: text(input.accessibilityNotes) || null,
      layouts,
      facilityIds,
    },
  };
}
