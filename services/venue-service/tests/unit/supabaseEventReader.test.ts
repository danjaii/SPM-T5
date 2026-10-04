import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, it, expect } from "vitest";
import { SupabaseEventReader } from "../../src/readers/supabaseEventReader";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";

const ROW = {
  id: "event-1",
  name: "Summit B",
  status: "approved",
  assigned_coordinator_id: "coordinator-1",
  expected_attendance: 50,
  accessibility_requirements: "Step-free access",
  preferred_start_datetime: "2030-11-14T01:00:00.000Z",
  preferred_end_datetime: "2030-11-14T09:00:00.000Z",
  room_layouts: { name: "Theatre" },
};

type Reply = { data: unknown; error: { message: string } | null };

/** Stubs from().select().eq() as a thenable that also has maybeSingle(). */
function stubDb(reply: Reply) {
  const db = {
    from: () => ({
      select: () => ({
        eq: () => Object.assign(Promise.resolve(reply), { maybeSingle: async () => reply }),
      }),
    }),
  } as unknown as SupabaseClient;
  return new SupabaseEventReader(db);
}

describe("SupabaseEventReader (DR16)", () => {
  it("maps an events row, taking venue requirements from the layout name", async () => {
    const event = await stubDb({ data: ROW, error: null }).getById("event-1");
    expect(event).toEqual({
      id: "event-1",
      name: "Summit B",
      status: "approved",
      assignedCoordinatorId: "coordinator-1",
      expectedAttendance: 50,
      venueRequirements: "Theatre",
      accessibilityNeeds: "Step-free access",
      proposedStart: new Date("2030-11-14T01:00:00.000Z"),
      proposedEnd: new Date("2030-11-14T09:00:00.000Z"),
    });
  });

  it("copes with a layout embed returned as an array, or missing, and empty optional columns", async () => {
    const sparse = {
      ...ROW,
      room_layouts: [{ name: "Banquet" }],
      assigned_coordinator_id: null,
      expected_attendance: null,
      accessibility_requirements: null,
      preferred_start_datetime: null,
      preferred_end_datetime: null,
    };
    const a = await stubDb({ data: sparse, error: null }).getById("event-1");
    expect(a).toMatchObject({ venueRequirements: "Banquet", assignedCoordinatorId: null, proposedStart: null });
    const b = await stubDb({ data: { ...sparse, room_layouts: null }, error: null }).getById("event-1");
    expect(b?.venueRequirements).toBeNull();
  });

  it("returns null when the event is missing or hidden by RLS", async () => {
    expect(await stubDb({ data: null, error: null }).getById("nope")).toBeNull();
  });

  it("throws on a database error", async () => {
    await expect(stubDb({ data: null, error: { message: "down" } }).getById("e")).rejects.toThrow(/Reading event failed/);
  });

  it("lists the ids of the events assigned to a coordinator", async () => {
    const ids = await stubDb({ data: [{ id: "a" }, { id: "b" }], error: null }).listIdsAssignedTo("coordinator-1");
    expect(ids).toEqual(["a", "b"]);
    expect(await stubDb({ data: null, error: null }).listIdsAssignedTo("x")).toEqual([]);
    await expect(stubDb({ data: null, error: { message: "down" } }).listIdsAssignedTo("x")).rejects.toThrow(
      /Listing events failed/,
    );
  });
});

describe("FakeEventReader", () => {
  it("finds events by id and by assigned coordinator", async () => {
    const reader = new FakeEventReader([anEvent(), anEvent({ id: "event-2", assignedCoordinatorId: "other" })]);
    reader.add(anEvent({ id: "event-3" }));
    expect((await reader.getById("event-1"))?.name).toBe("Summit B");
    expect(await reader.getById("missing")).toBeNull();
    expect(await reader.listIdsAssignedTo("coordinator-1")).toEqual(["event-1", "event-3"]);
  });
});
