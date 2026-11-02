import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { VenueInput } from "@spm-t5/shared";
import { BookingError } from "../../src/domain/errors";
import { SupabaseVenueCatalogueWriter } from "../../src/readers/venueCatalogueWriter";

const LAYOUT = "a685c8bf-c57d-5cb4-be30-49dedce9a02b";
const FACILITY = "8a02aa6c-e1ae-59e3-9d09-e5704315347d";

const input: VenueInput = {
  name: "Orchid Hall",
  address: "Level 3",
  description: null,
  maxCapacity: 150,
  operatingHoursStart: "08:00",
  operatingHoursEnd: "22:00",
  isAccessible: true,
  accessibilityNotes: null,
  layouts: [{ layoutId: LAYOUT, maxCapacity: 120 }],
  facilityIds: [FACILITY],
};

function writerWith(result: { data?: unknown; error?: { code: string; message: string } | null }) {
  const rpc = vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null }));
  return { rpc, writer: new SupabaseVenueCatalogueWriter({ rpc } as unknown as SupabaseClient) };
}

describe("SCRUM-57/AC1 the create_venue call (57-S1)", () => {
  it("57-S1: sends the cleaned values to create_venue and returns the new id", async () => {
    const { rpc, writer } = writerWith({ data: "venue-9" });

    expect(await writer.create(input)).toEqual({ id: "venue-9" });
    expect(rpc).toHaveBeenCalledWith("create_venue", {
      p_name: "Orchid Hall",
      p_address: "Level 3",
      p_description: null,
      p_max_capacity: 150,
      p_hours_start: "08:00",
      p_hours_end: "22:00",
      p_is_accessible: true,
      p_accessibility_notes: null,
      p_layouts: [{ layout_id: LAYOUT, max_capacity: 120 }],
      p_facility_ids: [FACILITY],
    });
  });
});

describe("SCRUM-57/AC2,AC3 what the database refuses becomes the right answer", () => {
  it("57-S3: the role check in the database is a 403", async () => {
    const { writer } = writerWith({ error: { code: "42501", message: "Only venue staff can add a venue." } });
    await expect(writer.create(input)).rejects.toMatchObject({ httpStatus: 403, code: "FORBIDDEN" });
  });

  it("57-S2: a layout or facility that does not exist is a 422 on that field", async () => {
    const layout = writerWith({ error: { code: "CS571", message: "Unknown layout." } });
    await expect(layout.writer.create(input)).rejects.toMatchObject({ httpStatus: 422, fieldErrors: { layouts: expect.any(String) } });

    const facility = writerWith({ error: { code: "CS572", message: "Unknown facility." } });
    await expect(facility.writer.create(input)).rejects.toMatchObject({ httpStatus: 422, fieldErrors: { facilityIds: expect.any(String) } });
  });

  it("57-S1: any other database error is thrown as it is, so the service answers 500 without details", async () => {
    const { writer } = writerWith({ error: { code: "XX000", message: "boom" } });
    const failure = await writer.create(input).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(BookingError);
  });
});
