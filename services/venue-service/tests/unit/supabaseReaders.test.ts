import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, it, expect } from "vitest";
import { supabasePorts } from "../../src/ports";
import { SupabaseRoleReader } from "../../src/readers/roleReader";
import { SupabaseVenueReader } from "../../src/readers/venueReader";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";
import type { SupabaseDeps } from "../../src/supabase";

type Reply = { data: unknown; error: { message: string } | null };

/** Every chained query method returns the chain; awaiting it or calling maybeSingle() gives the reply. */
function stubDb(reply: Reply) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) chain[m] = () => chain;
  chain.maybeSingle = async () => reply;
  chain.then = (resolve: (r: Reply) => unknown) => resolve(reply);
  return { from: () => chain } as unknown as SupabaseClient;
}

const VENUE = { id: "v1", name: "Orchid Hall", max_capacity: 150, is_active: true };

describe("SupabaseVenueReader", () => {
  it("maps a venue row and lists active venues", async () => {
    const reader = new SupabaseVenueReader(stubDb({ data: VENUE, error: null }));
    expect(await reader.getById("v1")).toEqual({ id: "v1", name: "Orchid Hall", maxCapacity: 150, isActive: true });
    const list = new SupabaseVenueReader(stubDb({ data: [VENUE], error: null }));
    expect(await list.listActive()).toHaveLength(1);
  });

  it("returns null for a missing venue and throws on errors", async () => {
    expect(await new SupabaseVenueReader(stubDb({ data: null, error: null })).getById("x")).toBeNull();
    const failing = new SupabaseVenueReader(stubDb({ data: null, error: { message: "down" } }));
    await expect(failing.getById("x")).rejects.toThrow(/Reading venue failed/);
    await expect(failing.listActive()).rejects.toThrow(/Listing venues failed/);
  });
});

describe("SupabaseRoleReader", () => {
  it("returns a real role and undefined for anything else", async () => {
    expect(await new SupabaseRoleReader(stubDb({ data: { role: "venue_staff" }, error: null })).roleOf("u")).toBe("venue_staff");
    expect(await new SupabaseRoleReader(stubDb({ data: { role: "wizard" }, error: null })).roleOf("u")).toBeUndefined();
    expect(await new SupabaseRoleReader(stubDb({ data: null, error: null })).roleOf("u")).toBeUndefined();
  });
});

describe("SupabaseBookingRepository.listByEvent", () => {
  it("maps rows, and fails with a generic message on error", async () => {
    const row = {
      id: "b1",
      event_id: "e1",
      venue_id: "v1",
      event_start_datetime: "2030-11-14T01:00:00.000Z",
      event_end_datetime: "2030-11-14T09:00:00.000Z",
      status: "rejected",
      created_at: "2030-01-01T00:00:00.000Z",
    };
    const rows = await new SupabaseBookingRepository(stubDb({ data: [row], error: null })).listByEvent("e1");
    expect(rows).toMatchObject([{ id: "b1", eventId: "e1", status: "rejected" }]);
    const failing = new SupabaseBookingRepository(stubDb({ data: null, error: { message: "secret" } }));
    await expect(failing.listByEvent("e1")).rejects.toThrow("Could not read the event's venue booking requests.");
  });
});

describe("supabasePorts", () => {
  it("builds every port on the caller's token-scoped client", () => {
    const tokens: string[] = [];
    const deps = { anon: {}, forUser: (t: string) => (tokens.push(t), stubDb({ data: null, error: null })) } as unknown as SupabaseDeps;
    const ports = supabasePorts(deps)("caller-token");
    expect(Object.keys(ports).sort()).toEqual(["bookings", "events", "roles", "venues"]);
    expect(tokens).toEqual(["caller-token"]);
  });
});
