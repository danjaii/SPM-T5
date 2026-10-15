import { utcToSgt } from "./venueBooking";

// SCRUM-109 (docs/specs/venue-suitability.md): does a venue suit an event? One pure check, shared by venue-service
// (the endpoint, the booking request) and apps/web, so every screen answers the same way. No I/O here: the caller
// reads the venue, the event and the availability and passes them in.

export const SUITABILITY_CRITERIA = ["capacity", "layout", "accessibility", "facilities", "operatingHours", "availability"] as const;
export type SuitabilityCriterion = (typeof SUITABILITY_CRITERIA)[number];

/** `met` and `not_met` are decided; `not_checked` means nothing was given to check; `manual` needs a person. */
export type CriterionStatus = "met" | "not_met" | "not_checked" | "manual";

export interface CriterionResult {
  key: SuitabilityCriterion;
  label: string;
  status: CriterionStatus;
  message: string;
}

export interface SuitabilityReport {
  /** "not_suitable" as soon as one criterion is `not_met`; `not_checked` and `manual` never decide it. */
  overall: "suitable" | "not_suitable";
  criteria: CriterionResult[];
  /** Free-text requirements nobody can compare automatically, shown under "Check manually". */
  manualChecks: string[];
}

/** What the check needs to know about a venue. */
export interface SuitabilityVenue {
  name: string;
  maxCapacity: number;
  /** Daily hours "HH:MM" (Singapore time); null when the venue states no limit. */
  openingTime: string | null;
  closingTime: string | null;
  isAccessible: boolean;
  accessibilityNotes: string | null;
  layouts: { name: string; maxCapacity: number }[];
}

/**
 * What the event asks for. `attendance` is an explicit input (not read from "the event") so a booking for one part of
 * an event can be checked against its own headcount later (SCRUM-110 Scenario 6, SCRUM-98).
 */
export interface SuitabilityRequirements {
  attendance: number | null;
  /** The preferred layout's name, e.g. "Theatre". */
  layoutName: string | null;
  /** Free text; it cannot be compared with the venue, so it is left for a person. */
  accessibilityNeeds: string | null;
  start: Date | null;
  end: Date | null;
}

/** A period that makes the venue unavailable. `exact` is false when only "held, somewhere in the period" is known. */
export interface AvailabilityConflict {
  start: Date;
  end: Date;
  exact?: boolean;
}

/** The answer of the availability lookup. Pass null to the check when there was nothing to look up. */
export interface AvailabilityResult {
  conflict: AvailabilityConflict | null;
}

export const NOT_SPECIFIED = "Not specified – not checked";

const LABELS: Record<SuitabilityCriterion, string> = {
  capacity: "Capacity",
  layout: "Layout",
  accessibility: "Accessibility",
  facilities: "Facilities",
  operatingHours: "Operating hours",
  availability: "Availability",
};

/**
 * Is the venue open for the whole period? A venue with no stated hours is always open; a closing time of "00:00" is
 * midnight. Times are "HH:MM" in Singapore time. For a period over several days this compares the first day's start
 * with the opening time and the last day's end with the closing time (same assumption as the venue search, SCRUM-65).
 */
export function isOpenDuring(openingTime: string | null, closingTime: string | null, startTime: string, endTime: string): boolean {
  if (!openingTime || !closingTime) return true;
  const closing = closingTime === "00:00" ? "24:00" : closingTime;
  return openingTime <= startTime && endTime <= closing;
}

const result = (key: SuitabilityCriterion, status: CriterionStatus, message: string): CriterionResult => ({
  key,
  label: LABELS[key],
  status,
  message,
});

const notChecked = (key: SuitabilityCriterion) => result(key, "not_checked", NOT_SPECIFIED);

function checkCapacity(venue: SuitabilityVenue, attendance: number | null, layoutName: string | null): CriterionResult {
  if (attendance === null) return notChecked("capacity");
  const layout = layoutName ? findLayout(venue, layoutName) : undefined;
  const capacity = layout ? layout.maxCapacity : venue.maxCapacity;
  return attendance > capacity
    ? result("capacity", "not_met", `Expected attendance ${attendance} exceeds capacity ${capacity}`)
    : result("capacity", "met", `Capacity ${capacity} fits ${attendance} attendees`);
}

const findLayout = (venue: SuitabilityVenue, name: string) =>
  venue.layouts.find((l) => l.name.toLowerCase() === name.trim().toLowerCase());

function checkLayout(venue: SuitabilityVenue, layoutName: string | null): CriterionResult {
  if (!layoutName?.trim()) return notChecked("layout");
  return findLayout(venue, layoutName)
    ? result("layout", "met", `${layoutName} supported`)
    : result("layout", "not_met", `${layoutName} not supported`);
}

function checkAccessibility(venue: SuitabilityVenue, needs: string | null): CriterionResult {
  const text = needs?.trim();
  if (!text) return notChecked("accessibility");
  const venueSide = venue.isAccessible ? "this venue is marked accessible" : "this venue is not marked accessible";
  return result("accessibility", "manual", `Check manually: ${text} (${venueSide})`);
}

function checkOperatingHours(venue: SuitabilityVenue, start: Date | null, end: Date | null): CriterionResult {
  if (!start || !end) return notChecked("operatingHours");
  if (!venue.openingTime || !venue.closingTime) return result("operatingHours", "met", "No stated opening hours");
  const startTime = utcToSgt(start).time;
  const endTime = utcToSgt(end).time;
  const hours = `${venue.openingTime}–${venue.closingTime}`;
  return isOpenDuring(venue.openingTime, venue.closingTime, startTime, endTime)
    ? result("operatingHours", "met", `Open ${hours}`)
    : result("operatingHours", "not_met", `Open ${hours}, the event runs ${startTime}–${endTime}`);
}

function checkAvailability(availability: AvailabilityResult | null): CriterionResult {
  if (!availability) return notChecked("availability");
  const { conflict } = availability;
  if (!conflict) return result("availability", "met", "Free for the whole period");
  if (conflict.exact === false) return result("availability", "not_met", "Already held for part of the requested period");
  const from = utcToSgt(conflict.start);
  const to = utcToSgt(conflict.end);
  const when = from.date === to.date ? `on ${from.date} from ${from.time} to ${to.time}` : `from ${from.date} ${from.time} to ${to.date} ${to.time}`;
  return result("availability", "not_met", `Occupied ${when}`);
}

/**
 * SCRUM-109: judges a venue against what is known of the event, one line per requirement. Requirements the event does
 * not state are `not_checked` (Scenario 6); facilities are always `not_checked` because the event records none yet.
 */
export function checkSuitability(
  venue: SuitabilityVenue,
  requirements: SuitabilityRequirements,
  availability: AvailabilityResult | null,
): SuitabilityReport {
  const criteria = [
    checkCapacity(venue, requirements.attendance, requirements.layoutName),
    checkLayout(venue, requirements.layoutName),
    checkAccessibility(venue, requirements.accessibilityNeeds),
    notChecked("facilities"),
    checkOperatingHours(venue, requirements.start, requirements.end),
    checkAvailability(availability),
  ];
  const note = requirements.accessibilityNeeds?.trim();
  return {
    overall: criteria.some((c) => c.status === "not_met") ? "not_suitable" : "suitable",
    criteria,
    manualChecks: note ? [note] : [],
  };
}

/** One requirement that is not met, as stored with a booking request (SCRUM-110) and shown to Venue Staff. */
export type UnmetRequirement = Pick<CriterionResult, "key" | "label" | "message">;

/** The `not_met` lines only: `not_checked` and `manual` lines never raise a warning (SCRUM-110). */
export function unmetRequirements(report: SuitabilityReport): UnmetRequirement[] {
  return report.criteria.filter((c) => c.status === "not_met").map(({ key, label, message }) => ({ key, label, message }));
}

// ---------------------------------------------------------------------------
// SCRUM-110: to request a venue that does not suit the event, the coordinator confirms with a reason (1 to 500
// characters once trimmed). Same rule in the form (apps/web) and the API.
// ---------------------------------------------------------------------------

export const SUITABILITY_OVERRIDE_MAX_LENGTH = 500;

export type ParsedSuitabilityOverride =
  | { ok: true; data: { reason: string | null } }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * Reads `overrideReason` from a request body. Absent, blank or not text is "no reason" (reason: null), which the caller
 * turns into the warning; only a reason that is too long is an error.
 */
export function parseSuitabilityOverride(body: unknown): ParsedSuitabilityOverride {
  const value = typeof body === "object" && body !== null ? (body as { overrideReason?: unknown }).overrideReason : undefined;
  const reason = typeof value === "string" ? value.trim() : "";
  if (reason.length > SUITABILITY_OVERRIDE_MAX_LENGTH) {
    return { ok: false, fieldErrors: { overrideReason: `The reason must be ${SUITABILITY_OVERRIDE_MAX_LENGTH} characters or fewer.` } };
  }
  return { ok: true, data: { reason: reason === "" ? null : reason } };
}
