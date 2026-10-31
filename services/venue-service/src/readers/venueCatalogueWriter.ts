import type { SupabaseClient } from "@supabase/supabase-js";
import type { VenueInput } from "@spm-t5/shared";
import { forbidden, validationFailed } from "../domain/errors";

/** SCRUM-57: adds a venue to the catalogue, with its layouts and facilities, in one step. */
export interface VenueCatalogueWriter {
  create(input: VenueInput): Promise<{ id: string }>;
}

const INSUFFICIENT_PRIVILEGE = "42501";
const UNKNOWN_LAYOUT = "CS571";
const UNKNOWN_FACILITY = "CS572";

/**
 * Calls the create_venue database function as the caller. The function (migration 73) writes the venue, its layouts and its
 * facilities in one transaction and allows venue staff only, so RLS stays the authority; the route's role check is just
 * the friendly 403.
 */
export class SupabaseVenueCatalogueWriter implements VenueCatalogueWriter {
  constructor(private readonly db: SupabaseClient) {}

  async create(input: VenueInput): Promise<{ id: string }> {
    const { data, error } = await this.db.rpc("create_venue", {
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
    });
    if (!error) return { id: data as string };

    if (error.code === INSUFFICIENT_PRIVILEGE) throw forbidden("Only venue staff can add a venue.");
    if (error.code === UNKNOWN_LAYOUT) throw validationFailed({ layouts: "One of the layouts is not in the catalogue. Choose it from the list." });
    if (error.code === UNKNOWN_FACILITY) throw validationFailed({ facilityIds: "One of the facilities is not in the catalogue. Choose it from the list." });
    throw new Error(`Adding the venue failed: ${error.message}`, { cause: error });
  }
}
