import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, it, expect } from "vitest";
import { supabasePorts } from "../../src/ports";
import { SupabaseRoleReader } from "../../src/readers/roleReader";
import { SupabaseUserReader } from "../../src/readers/userReader";
import { SupabaseVenueDetailsReader } from "../../src/readers/venueDetailsReader";
import { SupabaseVenueReader } from "../../src/readers/venueReader";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";
import type { SupabaseDeps } from "../../src/supabase";

type Reply = { data: unknown; error: { message: string } | null };

/** Every chained query method returns the chain; awaiting it or calling maybeSingle() gives the reply. */
function stubDb(reply: Reply) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order"]) chain[m] = () => chain;
  chain.maybeSingle = async () => reply;
  chain.then = (resolve: (r: Reply) => unknown) => resolve(reply);
  return { from: () => chain } as unknown as SupabaseClient;
}

const VENUE = { id: "v1", name: "Orchid Hall", max_capacity: 150, is_active: true };

describe("SupabaseVenueReader", () => {
  it("maps a venue row", async () => {
    const reader = new SupabaseVenueReader(stubDb({ data: VENUE, error: null }));
    expect(await reader.getById("v1")).toEqual({ id: "v1", name: "Orchid Hall", maxCapacity: 150, isActive: true, setupMinutes: 0, turnaroundMinutes: 0 });
  });

  it("SCRUM-101: reads the setup and turnaround times", async () => {
    const reader = new SupabaseVenueReader(stubDb({ data: { ...VENUE, setup_minutes: 30, turnaround_minutes: 45 }, error: null }));
    expect(await reader.getById("v1")).toMatchObject({ setupMinutes: 30, turnaroundMinutes: 45 });
  });

  it("returns null for a missing venue and throws on errors", async () => {
    expect(await new SupabaseVenueReader(stubDb({ data: null, error: null })).getById("x")).toBeNull();
    const failing = new SupabaseVenueReader(stubDb({ data: null, error: { message: "down" } }));
    await expect(failing.getById("x")).rejects.toThrow(/Reading venue failed/);
  });
});

describe("SupabaseVenueDetailsReader (SCRUM-109)", () => {
  const ROW = {
    id: "v1",
    name: "Orchid Hall",
    address: "1 Orchard Road",
    max_capacity: 200,
    operating_hours_start: "08:00:00",
    operating_hours_end: "22:00:00",
    is_accessible: true,
    accessibility_notes: null,
    venue_supported_layouts: [{ max_capacity_for_layout: 180, room_layouts: { id: "l1", name: "Theatre" } }],
    venue_facilities: [{ facilities: { id: "f1", name: "Projector" } }],
  };

  it("maps the venue with its hours trimmed to HH:MM, layouts and facilities", async () => {
    const venue = await new SupabaseVenueDetailsReader(stubDb({ data: ROW, error: null })).getById("v1");
    expect(venue).toMatchObject({
      id: "v1",
      maxCapacity: 200,
      openingTime: "08:00",
      closingTime: "22:00",
      layouts: [{ id: "l1", name: "Theatre", maxCapacity: 180 }],
      facilities: [{ id: "f1", name: "Projector" }],
    });
  });

  it("returns null for a missing venue and throws on errors", async () => {
    expect(await new SupabaseVenueDetailsReader(stubDb({ data: null, error: null })).getById("x")).toBeNull();
    await expect(new SupabaseVenueDetailsReader(stubDb({ data: null, error: { message: "down" } })).getById("x")).rejects.toThrow(
      /Reading venue failed/,
    );
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

describe("SupabaseBookingRepository getById and listByEvents (SCRUM-33)", () => {
  const row = {
    id: "b1",
    event_id: "e1",
    venue_id: "v1",
    event_start_datetime: "2030-11-14T01:00:00.000Z",
    event_end_datetime: "2030-11-14T09:00:00.000Z",
    status: "requested",
    created_at: "2030-01-01T00:00:00.000Z",
  };

  it("getById maps a row, returns null when missing and fails generically", async () => {
    expect(await new SupabaseBookingRepository(stubDb({ data: row, error: null })).getById("b1")).toMatchObject({ id: "b1" });
    expect(await new SupabaseBookingRepository(stubDb({ data: null, error: null })).getById("x")).toBeNull();
    await expect(new SupabaseBookingRepository(stubDb({ data: null, error: { message: "s" } })).getById("x")).rejects.toThrow(
      "Could not read the venue booking request.",
    );
  });

  it("listByEvents skips the query for no events, maps rows and fails generically", async () => {
    const failing = new SupabaseBookingRepository(stubDb({ data: null, error: { message: "s" } }));
    expect(await failing.listByEvents([])).toEqual([]);
    expect(await new SupabaseBookingRepository(stubDb({ data: [row], error: null })).listByEvents(["e1"])).toHaveLength(1);
    await expect(failing.listByEvents(["e1"])).rejects.toThrow("Could not read your venue booking requests.");
  });
});

describe("SupabaseBookingRepository seams: listPending, withdraw, decide (SCRUM-35, SCRUM-37 to 40)", () => {
  const row = {
    id: "b1",
    event_id: "e1",
    venue_id: "v1",
    event_start_datetime: "2030-11-14T01:00:00.000Z",
    event_end_datetime: "2030-11-14T09:00:00.000Z",
    status: "withdrawn",
    created_at: "2030-01-01T00:00:00.000Z",
  };
  const at = new Date("2030-02-01T00:00:00.000Z");

  /** Like stubDb, but records the patch passed to update(). */
  function recording(reply: Reply) {
    const patches: unknown[] = [];
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) chain[m] = () => chain;
    chain.update = (patch: unknown) => (patches.push(patch), chain);
    chain.maybeSingle = async () => reply;
    chain.then = (resolve: (r: Reply) => unknown) => resolve(reply);
    return { repo: new SupabaseBookingRepository({ from: () => chain } as unknown as SupabaseClient), patches };
  }

  it("listPending maps rows and fails generically", async () => {
    expect(await new SupabaseBookingRepository(stubDb({ data: [row], error: null })).listPending()).toHaveLength(1);
    await expect(new SupabaseBookingRepository(stubDb({ data: null, error: { message: "s" } })).listPending()).rejects.toThrow(
      "Could not read the pending venue booking requests.",
    );
  });

  it("withdraw sets status, who and when; null when it was not pending", async () => {
    const { repo, patches } = recording({ data: row, error: null });
    expect(await repo.withdraw("b1", "u1", at)).toMatchObject({ id: "b1" });
    expect(patches[0]).toEqual({ status: "withdrawn", withdrawn_by: "u1", withdrawn_at: at.toISOString() });
    expect(await recording({ data: null, error: null }).repo.withdraw("b1", "u1", at)).toBeNull();
    await expect(recording({ data: null, error: { message: "secret" } }).repo.withdraw("b1", "u1", at)).rejects.toThrow(
      "Could not update the venue booking request.",
    );
  });

  it("decide records the reviewer, and a rejection's reason and suggestion", async () => {
    const approve = recording({ data: row, error: null });
    await approve.repo.decide("b1", { outcome: "approved" }, "staff", at);
    expect(approve.patches[0]).toEqual({ status: "approved", reviewed_by: "staff", reviewed_at: at.toISOString() });

    const reject = recording({ data: row, error: null });
    const end = new Date("2030-03-01T00:00:00.000Z");
    await reject.repo.decide("b1", { outcome: "rejected", reason: "No", suggestion: { venueId: "v2", start: at, end } }, "staff", at);
    expect(reject.patches[0]).toMatchObject({
      status: "rejected",
      review_notes: "No",
      suggested_venue_id: "v2",
      suggested_start_datetime: at.toISOString(),
      suggested_end_datetime: end.toISOString(),
    });

    const bare = recording({ data: row, error: null });
    await bare.repo.decide("b1", { outcome: "rejected" }, "staff", at);
    expect(bare.patches[0]).toMatchObject({ review_notes: null });
    expect(bare.patches[0]).not.toHaveProperty("suggested_venue_id");
  });
});

describe("SupabaseVenueReader.getByIds", () => {
  it("returns nothing for no ids, maps rows and throws on errors", async () => {
    const failing = new SupabaseVenueReader(stubDb({ data: null, error: { message: "down" } }));
    expect(await failing.getByIds([])).toEqual([]);
    expect(await new SupabaseVenueReader(stubDb({ data: [VENUE], error: null })).getByIds(["v1"])).toHaveLength(1);
    await expect(failing.getByIds(["v1"])).rejects.toThrow(/Reading venues failed/);
  });
});

describe("supabasePorts", () => {
  it("builds every port on the caller's token-scoped client", () => {
    const tokens: string[] = [];
    const deps = { anon: {}, forUser: (t: string) => (tokens.push(t), stubDb({ data: null, error: null })) } as unknown as SupabaseDeps;
    const ports = supabasePorts(deps)("caller-token");
    expect(Object.keys(ports).sort()).toEqual(["bookings", "events", "roles", "users", "venueDetails", "venues"]);
    expect(tokens).toEqual(["caller-token"]);
  });
});

describe("SupabaseUserReader", () => {
  it("maps ids to full names, skips the query for no ids, and throws on errors", async () => {
    const reader = new SupabaseUserReader(stubDb({ data: [{ id: "u1", full_name: "Casey Coordinator" }], error: null }));
    expect(await reader.namesOf(["u1"])).toEqual(new Map([["u1", "Casey Coordinator"]]));
    expect((await reader.namesOf([])).size).toBe(0);
    await expect(new SupabaseUserReader(stubDb({ data: null, error: { message: "down" } })).namesOf(["u1"])).rejects.toThrow(
      /Reading users failed/,
    );
  });
});
