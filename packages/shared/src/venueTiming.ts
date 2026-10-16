import type { Role } from "./roles";

// SCRUM-101 (docs/specs/venue-setup-turnaround.md): a venue's setup and turnaround times. The checks live here so
// the edit form and venue-service use the very same code and can never disagree.

/** One day, a typo guard (the Jira story only says whole minutes, 0 or more). */
export const VENUE_TIMING_MAX_MINUTES = 1440;

/** 101-S4: only Venue Staff may change a venue's times; coordinators see them read-only. */
export function canEditVenueTiming(role: Role): boolean {
  return role === "venue_staff";
}

export interface VenueTimingInput {
  setupMinutes: number;
  turnaroundMinutes: number;
}

export type ParsedVenueTimingInput =
  | { ok: true; data: VenueTimingInput }
  | { ok: false; fieldErrors: Partial<Record<keyof VenueTimingInput, string>> };

/** A whole number 0..max given as a number or a numeric string; null for anything else. */
function wholeMinutes(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(text)) return null;
  const minutes = Number(text);
  return minutes <= VENUE_TIMING_MAX_MINUTES ? minutes : null;
}

/** 101-S1/S3: checks both fields together, so the form can show every problem at once. */
export function parseVenueTimingInput(body: unknown): ParsedVenueTimingInput {
  const input = (body !== null && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const setup = wholeMinutes(input.setupMinutes);
  const turnaround = wholeMinutes(input.turnaroundMinutes);

  const fieldErrors: Partial<Record<keyof VenueTimingInput, string>> = {};
  if (setup === null) fieldErrors.setupMinutes = "Setup time must be a whole number of minutes, 0 or more.";
  if (turnaround === null) fieldErrors.turnaroundMinutes = "Turnaround time must be a whole number of minutes, 0 or more.";
  if (setup === null || turnaround === null) return { ok: false, fieldErrors };
  return { ok: true, data: { setupMinutes: setup, turnaroundMinutes: turnaround } };
}
