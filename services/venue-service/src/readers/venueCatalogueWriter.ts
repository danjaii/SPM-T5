import type { SupabaseClient } from "@supabase/supabase-js";
import type { VenueInput } from "@spm-t5/shared";
import { forbidden, notFound, validationFailed } from "../domain/errors";

/** SCRUM-57: adds a venue to the catalogue, with its layouts and facilities, in one step. SCRUM-58: and edits one the same way. */
export interface VenueCatalogueWriter {
  create(input: VenueInput): Promise<{ id: string }>;
  update(venueId: string, input: VenueInput): Promise<void>;
}

const INSUFFICIENT_PRIVILEGE = "42501";
const NO_SUCH_VENUE = "P0002";
const UNKNOWN_LAYOUT = "CS571";
const UNKNOWN_FACILITY = "CS572";

/**
 * Calls the create_venue (migration 73) and update_venue (migration 74) database functions as the caller. Each writes the venue,
 * its layouts and its facilities in one transaction and allows venue staff only, so RLS stays the authority; the route's role
 * check is just the friendly 403.
 */
export class SupabaseVenueCatalogueWriter implements VenueCatalogueWriter {
  constructor(private readonly db: SupabaseClient) {}

  async create(input: VenueInput): Promise<{ id: string }> {
    const { data, error } = await this.db.rpc("create_venue", params(input));
    if (!error) return { id: data as string };
    throw refusal(error, "add");
  }

  async update(venueId: string, input: VenueInput): Promise<void> {
    const { error } = await this.db.rpc("update_venue", { p_venue_id: venueId, ...params(input) });
    if (error) throw refusal(error, "edit");
  }
}

function params(input: VenueInput) {
  return {
    p_name: input.name,
    p_address: input.address,
    p_description: input.description,
    p_max_capacity: input.maxCapacity,
    p_hours_start: input.operatingHoursStart,
    p_hours_end: input.operatingHoursEnd,
    p_is_accessible: input.isAccessible,
    p_accessibility_notes: input.accessibilityNotes,
    p_layouts: input.layouts.map((l) => ({ layout_id: l.layoutId, max_capacity: l.maxCapacity })),
    p_facility_ids: input.facilityIds,
  };
}

/** What a refused call becomes: the friendly answer for the refusals the functions raise on purpose, anything else as it is. */
function refusal(error: { code?: string; message: string }, verb: "add" | "edit"): Error {
  if (error.code === INSUFFICIENT_PRIVILEGE) return forbidden(`Only venue staff can ${verb} a venue.`);
  if (error.code === NO_SUCH_VENUE) return notFound("Venue not found.");
  if (error.code === UNKNOWN_LAYOUT) return validationFailed({ layouts: "One of the layouts is not in the catalogue. Choose it from the list." });
  if (error.code === UNKNOWN_FACILITY) return validationFailed({ facilityIds: "One of the facilities is not in the catalogue. Choose it from the list." });
  return new Error(`Saving the venue failed: ${error.message}`, { cause: error });
}
