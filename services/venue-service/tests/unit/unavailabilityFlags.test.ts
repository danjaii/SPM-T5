import request from "supertest";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sgtToUtc } from "@spm-t5/shared";
import { toFlagDto } from "../../src/domain/dto";
import type { FlagRecord } from "../../src/domain/types";
import { createApp } from "../../src/app";
import { SupabaseVenueUnavailabilityStore } from "../../src/readers/venueUnavailabilityStore";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeVenueUnavailabilityStore } from "../support/fakeVenueUnavailabilityStore";

// SCRUM-106 (docs/specs/venue-unavailability-flags.md): the flag as a coordinator sees it, and the count Venue Staff get back.
const NOW = new Date("2026-10-01T00:00:00.000Z");

const blockFlag = (over: Partial<FlagRecord> = {}): FlagRecord => ({
  id: "f1",
  bookingId: "b1",
  kind: "venue_unavailable",
  otherBookingId: null,
  otherStart: sgtToUtc("2026-11-14", "08:00"),
  otherEnd: sgtToUtc("2026-11-16", "18:00"),
  unavailabilityId: "u1",
  unavailabilityReason: "maintenance",
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  ...over,
});

describe("SCRUM-106/AC1 toFlagDto shows the block of a venue_unavailable flag (106-S1)", () => {
  it("106-S1: the block's Singapore dates, times and reason label; otherPeriod stays null because a block can span days", () => {
    expect(toFlagDto(blockFlag())).toEqual({
      id: "f1",
      kind: "venue_unavailable",
      label: "Venue unavailable – alternative needed",
      createdAt: "2026-10-01T00:00:00.000Z",
      otherPeriod: null,
      unavailability: { startDate: "2026-11-14", startTime: "08:00", endDate: "2026-11-16", endTime: "18:00", reason: "maintenance", reasonLabel: "Maintenance" },
    });
  });

  it("106-S1: Venue Staff get the same block, and no event name (there is no other booking)", () => {
    const dto = toFlagDto(blockFlag({ unavailabilityReason: "safety" }), { otherEventName: null });
    expect(dto.unavailability).toMatchObject({ reason: "safety", reasonLabel: "Safety concern" });
    expect(dto.otherEventName).toBeNull();
    expect(dto.otherBookingId).toBeNull();
  });

  it("106-S7: a buffer conflict keeps its single-day otherPeriod and has no unavailability", () => {
    const dto = toFlagDto(
      blockFlag({
        kind: "buffer_conflict",
        otherBookingId: "b2",
        otherStart: sgtToUtc("2026-11-14", "12:30"),
        otherEnd: sgtToUtc("2026-11-14", "14:00"),
        unavailabilityId: null,
        unavailabilityReason: null,
      }),
    );
    expect(dto.otherPeriod).toEqual({ date: "2026-11-14", startTime: "12:30", endTime: "14:00" });
    expect(dto.unavailability).toBeUndefined();
  });
});

describe("SCRUM-106/AC5 SupabaseVenueUnavailabilityStore.mark reports how many bookings were flagged (106-S5, 106-S6)", () => {
  const blockRow = {
    id: "u1",
    start_datetime: "2026-11-14T00:00:00.000Z",
    end_datetime: "2026-11-16T10:00:00.000Z",
    reason: "maintenance",
    notes: null,
    created_at: "2026-10-01T00:00:00.000Z",
  };
  const clientReturning = (rpcData: unknown) =>
    ({
      rpc: async () => ({ data: rpcData, error: null }),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: blockRow, error: null }) }) }) }),
    }) as unknown as SupabaseClient;
  const input = { start: new Date("2026-11-14T00:00:00.000Z"), end: new Date("2026-11-16T10:00:00.000Z"), reason: "maintenance" };

  it("106-S5: the count comes from the function's row, as a number", async () => {
    const result = await new SupabaseVenueUnavailabilityStore(clientReturning([{ block_id: "u1", flagged_count: 3 }])).mark("v1", input);
    expect(result.affectedBookings).toBe(3);
    expect(result.block.id).toBe("u1");
  });

  it("106-S6: a block that overlaps nothing says zero", async () => {
    const result = await new SupabaseVenueUnavailabilityStore(clientReturning([{ block_id: "u1", flagged_count: 0 }])).mark("v1", input);
    expect(result.affectedBookings).toBe(0);
  });

  it("106-S5: an empty answer is a failure, never a silent zero", async () => {
    await expect(new SupabaseVenueUnavailabilityStore(clientReturning([])).mark("v1", input)).rejects.toThrow("Could not save the unavailability.");
  });
});

describe("SCRUM-106/AC5 POST /venues/:id/unavailability tells Venue Staff how many bookings it flagged", () => {
  function arrange() {
    const sessions = new Map<string, string>();
    const users: Record<string, unknown>[] = [];
    const query = (table: string) => {
      const rows = table === "users" ? users : [{ id: "orchid", name: "Orchid Hall" }];
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
      anon: { auth: { getUser: async (token: string) => ({ data: { user: { id: sessions.get(token) } }, error: null }) } },
      forUser: () => ({ from: (table: string) => query(table) }),
    } as unknown as SupabaseDeps;
    const id = crypto.randomUUID();
    users.push({ id, role: "venue_staff", full_name: "Kenneth Wong", is_active: true });
    sessions.set(`token-${id}`, id);
    const store = new FakeVenueUnavailabilityStore();
    const app = createApp(deps, { now: () => NOW, venueUnavailability: () => store, venueAvailability: () => new FakeBookingRepository() });
    return { app, store, cookie: `cs_session=token-${id}` };
  }
  const BODY = { startDate: "2026-11-14", startTime: "08:00", endDate: "2026-11-16", endTime: "18:00", reason: "maintenance" };

  it.each([
    [0, "No existing bookings are affected."],
    [1, "1 booking affected; its coordinator has been notified."],
    [3, "3 bookings affected; their coordinators have been notified."],
  ])("106-S5: %i flagged -> 201 with affectedBookings and the sentence for the form", async (count, message) => {
    const { app, store, cookie } = arrange();
    store.affectedBookings = count;

    const res = await request(app).post("/venues/orchid/unavailability").set("Cookie", cookie).send(BODY);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ affectedBookings: count, message });
    expect(res.body.block).toMatchObject({ reason: "maintenance" });
  });
});
