import request from "supertest";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sgtToUtc } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import { SupabaseVenueUnavailabilityStore } from "../../src/readers/venueUnavailabilityStore";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeVenueUnavailabilityStore } from "../support/fakeVenueUnavailabilityStore";

// SCRUM-185/AC2 (docs/specs/venue-block-lifting.md): the lift endpoint and the store's mapping of the database's answers.
type Row = Record<string, unknown>;
const NOW = new Date("2026-10-01T00:00:00.000Z");

function arrange() {
  const sessions = new Map<string, string>();
  const users: Row[] = [];
  const query = (table: string) => {
    const rows = table === "users" ? users : [{ id: "orchid", name: "Orchid Hall", setup_minutes: 30, turnaround_minutes: 0 }];
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return builder;
  };
  const deps = {
    anon: { auth: { getUser: async (token: string) => ({ data: { user: sessions.has(token) ? { id: sessions.get(token) } : null }, error: null }) } },
    forUser: () => ({ from: (table: string) => query(table) }),
  } as unknown as SupabaseDeps;
  const signIn = (role: string) => {
    const id = crypto.randomUUID();
    users.push({ id, role, full_name: "Test User", is_active: true });
    sessions.set(`token-${id}`, id);
    return { cookie: `cs_session=token-${id}` };
  };
  const store = new FakeVenueUnavailabilityStore();
  const bookings = new FakeBookingRepository();
  bookings.setVenue("orchid", { name: "Orchid Hall", setupMinutes: 30 });
  const app = createApp(deps, { now: () => NOW, venueUnavailability: () => store, venueAvailability: () => bookings });
  return { app, store, signIn };
}

const block = (store: FakeVenueUnavailabilityStore, venueId = "orchid") =>
  store.seed(venueId, sgtToUtc("2026-11-14", "08:00"), sgtToUtc("2026-11-16", "18:00"));

describe("SCRUM-185/AC2 POST /venues/:id/unavailability/:blockId/lift (185-S2)", () => {
  it("185-S2: Venue Staff lift the block; the answer says how many coordinators were told", async () => {
    const { app, store, signIn } = arrange();
    const staff = signIn("venue_staff");
    const target = block(store);
    store.coordinatorsTold = 2;

    const res = await request(app).post(`/venues/orchid/unavailability/${target.id}/lift`).set("Cookie", staff.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lifted: true, notifiedCoordinators: 2, message: "Unavailable period lifted. 2 coordinators have been notified." });
    expect(store.lifted).toEqual([{ venueId: "orchid", blockId: target.id }]);
    expect(store.rows).toEqual([]);
  });

  it("185-S2b: a block that told nobody says so", async () => {
    const { app, store, signIn } = arrange();
    const staff = signIn("venue_staff");
    const target = block(store);

    const res = await request(app).post(`/venues/orchid/unavailability/${target.id}/lift`).set("Cookie", staff.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ notifiedCoordinators: 0, message: "Unavailable period lifted. No coordinators needed to be told." });
  });

  it("185-S2: the venue's detail no longer lists the block afterwards", async () => {
    const { app, store, signIn } = arrange();
    const staff = signIn("venue_staff");
    const target = block(store);
    await request(app).post(`/venues/orchid/unavailability/${target.id}/lift`).set("Cookie", staff.cookie);

    const res = await request(app).get("/venues/orchid").set("Cookie", staff.cookie);

    expect(res.body.unavailability).toEqual([]);
  });
});

describe("SCRUM-185/AC2 only Venue Staff may lift (185-S2c)", () => {
  it("185-S2c: a coordinator gets 403 and the block stays", async () => {
    const { app, store, signIn } = arrange();
    const coordinator = signIn("event_coordinator");
    const target = block(store);

    const res = await request(app).post(`/venues/orchid/unavailability/${target.id}/lift`).set("Cookie", coordinator.cookie);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
    expect(store.lifted).toEqual([]);
    expect(store.rows).toHaveLength(1);
  });

  it("185-S2c: an organiser and an attendee get 403, and no session is 401", async () => {
    const { app, store, signIn } = arrange();
    const target = block(store);
    for (const role of ["event_organiser", "attendee"]) {
      const user = signIn(role);
      expect((await request(app).post(`/venues/orchid/unavailability/${target.id}/lift`).set("Cookie", user.cookie)).status).toBe(403);
    }
    expect((await request(app).post(`/venues/orchid/unavailability/${target.id}/lift`)).status).toBe(401);
    expect(store.lifted).toEqual([]);
  });
});

describe("SCRUM-185/AC2 the block must exist and belong to the venue (185-S2d)", () => {
  it("185-S2d: an unknown block is 404", async () => {
    const { app, store, signIn } = arrange();
    const staff = signIn("venue_staff");
    const res = await request(app).post("/venues/orchid/unavailability/nope/lift").set("Cookie", staff.cookie);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
    expect(store.rows).toEqual([]);
  });

  it("185-S2d: a block of another venue is 404 and stays", async () => {
    const { app, store, signIn } = arrange();
    const staff = signIn("venue_staff");
    const other = block(store, "somewhere-else");

    const res = await request(app).post(`/venues/orchid/unavailability/${other.id}/lift`).set("Cookie", staff.cookie);

    expect(res.status).toBe(404);
    expect(store.rows).toHaveLength(1);
  });
});

describe("SCRUM-185/AC2 SupabaseVenueUnavailabilityStore.lift maps the database's answers (185-S2)", () => {
  const clientAnswering = (answer: { data?: unknown; error?: { code: string; message: string } | null }) => {
    const calls: { name: string; args: unknown }[] = [];
    const client = {
      rpc: async (name: string, args: unknown) => {
        calls.push({ name, args });
        return { data: answer.data ?? null, error: answer.error ?? null };
      },
    } as unknown as SupabaseClient;
    return { store: new SupabaseVenueUnavailabilityStore(client), calls };
  };

  it("185-S2: calls lift_venue_unavailability and returns both counts as numbers", async () => {
    const { store, calls } = clientAnswering({ data: [{ flags_cleared: 3, notified: 2 }] });
    expect(await store.lift("v1", "b1")).toEqual({ flagsCleared: 3, notified: 2 });
    expect(calls).toEqual([{ name: "lift_venue_unavailability", args: { p_venue_id: "v1", p_block_id: "b1" } }]);
  });

  it("185-S2c: a role refusal is 403", async () => {
    const { store } = clientAnswering({ error: { code: "42501", message: "no" } });
    await expect(store.lift("v1", "b1")).rejects.toMatchObject({ httpStatus: 403, code: "FORBIDDEN" });
  });

  it.each(["P0002", "22P02"])("185-S2d: %s (not found, or not an id) is 404", async (code) => {
    const { store } = clientAnswering({ error: { code, message: "x" } });
    await expect(store.lift("v1", "b1")).rejects.toMatchObject({ httpStatus: 404, code: "NOT_FOUND" });
  });

  it("185-S2: any other error is a failure, and an empty answer is never a silent success", async () => {
    await expect(clientAnswering({ error: { code: "XX000", message: "boom" } }).store.lift("v1", "b1")).rejects.toThrow("Could not lift the unavailable period.");
    await expect(clientAnswering({ data: [] }).store.lift("v1", "b1")).rejects.toThrow("Could not lift the unavailable period.");
  });
});
