import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseVenueTimingWriter } from "../../src/readers/venueTimingWriter";

describe("SCRUM-101/AC1 SupabaseVenueTimingWriter calls set_venue_timing (101-S1)", () => {
  it("101-S1: passes the venue and both times to the function", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    await new SupabaseVenueTimingWriter({ rpc } as unknown as SupabaseClient).set("v1", 30, 45);
    expect(rpc).toHaveBeenCalledWith("set_venue_timing", { p_venue_id: "v1", p_setup: 30, p_turnaround: 45 });
  });

  it("101-S4: a refusal from the database surfaces as an error", async () => {
    const rpc = vi.fn(async () => ({ error: { message: "not allowed", code: "42501" } }));
    await expect(new SupabaseVenueTimingWriter({ rpc } as unknown as SupabaseClient).set("v1", 1, 1)).rejects.toThrow(/not allowed/);
  });
});
