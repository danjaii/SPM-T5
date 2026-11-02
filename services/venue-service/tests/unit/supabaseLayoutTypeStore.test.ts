import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { BookingError } from "../../src/domain/errors";
import { SupabaseLayoutTypeStore } from "../../src/readers/layoutTypeStore";

const ID = "a685c8bf-c57d-5cb4-be30-49dedce9a02b";

type Reply = { data?: unknown; error?: { code: string; message: string } | null };

function storeWith(reply: Reply) {
  const rpc = vi.fn(async () => ({ data: reply.data ?? null, error: reply.error ?? null }));
  const order = vi.fn(async () => ({ data: reply.data ?? null, error: reply.error ?? null }));
  const select = vi.fn(() => ({ order }));
  const from = vi.fn(() => ({ select }));
  return { rpc, from, select, order, store: new SupabaseLayoutTypeStore({ rpc, from } as unknown as SupabaseClient) };
}

describe("SCRUM-181/AC1 the create_layout_type call (181-S1)", () => {
  it("181-S1: sends the name to create_layout_type and returns the new type", async () => {
    const { rpc, store } = storeWith({ data: { id: ID, name: "Cabaret" } });

    expect(await store.create("Cabaret")).toEqual({ id: ID, name: "Cabaret" });
    expect(rpc).toHaveBeenCalledWith("create_layout_type", { p_name: "Cabaret" });
  });
});

describe("SCRUM-181/AC2 the rename_layout_type call (181-S2)", () => {
  it("181-S2: sends the id and the name to rename_layout_type", async () => {
    const { rpc, store } = storeWith({ data: { id: ID, name: "Lecture Theatre" } });

    expect(await store.rename(ID, "Lecture Theatre")).toEqual({ id: ID, name: "Lecture Theatre" });
    expect(rpc).toHaveBeenCalledWith("rename_layout_type", { p_id: ID, p_name: "Lecture Theatre" });
  });
});

describe("SCRUM-181/AC3,AC4 the delete_layout_type call (181-S3, S4)", () => {
  it("181-S3: sends the id to delete_layout_type and returns the deleted type", async () => {
    const { rpc, store } = storeWith({ data: { deleted: true, name: "Cabaret" } });

    expect(await store.remove(ID)).toEqual({ id: ID, name: "Cabaret" });
    expect(rpc).toHaveBeenCalledWith("delete_layout_type", { p_id: ID });
  });

  it("181-S4: an in-use answer becomes a 409 that names the venues and counts the event requests", async () => {
    const venues = [{ id: "v1", name: "Hall A" }];
    const { store } = storeWith({ data: { deleted: false, name: "Theatre", venues, event_count: 3 } });

    const failure = await store.remove(ID).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(BookingError);
    expect(failure).toMatchObject({
      httpStatus: 409,
      code: "LAYOUT_TYPE_IN_USE",
      message: '"Theatre" cannot be deleted because 1 venue uses it: Hall A, and 3 event requests prefer it.',
      usedBy: { venues, eventCount: 3 },
    });
  });

  it("181-S4: an in-use answer with no lists is read as nothing named and nothing counted", async () => {
    const { store } = storeWith({ data: { deleted: false, name: "Theatre" } });

    await expect(store.remove(ID)).rejects.toMatchObject({ usedBy: { venues: [], eventCount: 0 } });
  });
});

describe("SCRUM-181/AC5,AC6 what the database refuses becomes the right answer", () => {
  it.each([
    ["add", (s: SupabaseLayoutTypeStore) => s.create("x")],
    ["rename", (s: SupabaseLayoutTypeStore) => s.rename(ID, "x")],
    ["delete", (s: SupabaseLayoutTypeStore) => s.remove(ID)],
  ] as const)("181-S6: the role check in the database is a 403 on %s", async (verb, call) => {
    const { store } = storeWith({ error: { code: "42501", message: "nope" } });

    await expect(call(store)).rejects.toMatchObject({ httpStatus: 403, code: "FORBIDDEN", message: `Only venue staff can ${verb} a layout type.` });
  });

  it("181-S2: an unknown id is a 404", async () => {
    const { store } = storeWith({ error: { code: "P0002", message: "Layout type not found." } });

    await expect(store.rename(ID, "x")).rejects.toMatchObject({ httpStatus: 404, code: "NOT_FOUND" });
    await expect(store.remove(ID)).rejects.toMatchObject({ httpStatus: 404, code: "NOT_FOUND" });
  });

  it.each([
    ["an invalid name", "22023", "Enter a name for the layout type."],
    ["a duplicate name", "23505", "A layout type with that name already exists."],
  ])("181-S5: %s is a 422 on the name field with the database's reason", async (_label, code, message) => {
    const { store } = storeWith({ error: { code, message } });

    await expect(store.create("x")).rejects.toMatchObject({ httpStatus: 422, fieldErrors: { name: message } });
  });

  it("181-S1: any other database error is thrown as it is, so the service answers 500 without details", async () => {
    const { store } = storeWith({ error: { code: "XX000", message: "boom" } });

    const failure = await store.create("x").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(BookingError);
  });
});

describe("SCRUM-181/AC1 the list of layout types (181-S1)", () => {
  it("181-S1: reads every layout type by name with the number of venues that support it", async () => {
    const { from, select, order, store } = storeWith({
      data: [
        { id: "l1", name: "Banquet", is_active: true, venue_supported_layouts: [{ count: 3 }] },
        { id: "l2", name: "Cabaret", is_active: false, venue_supported_layouts: [] },
        { id: "l3", name: "Theatre", is_active: true, venue_supported_layouts: null },
      ],
    });

    expect(await store.list()).toEqual([
      { id: "l1", name: "Banquet", isActive: true, venueCount: 3 },
      { id: "l2", name: "Cabaret", isActive: false, venueCount: 0 },
      { id: "l3", name: "Theatre", isActive: true, venueCount: 0 },
    ]);
    expect(from).toHaveBeenCalledWith("room_layouts");
    expect(select).toHaveBeenCalledWith("id, name, is_active, venue_supported_layouts(count)");
    expect(order).toHaveBeenCalledWith("name");
  });

  it("181-S1: no rows is an empty list", async () => {
    expect(await storeWith({ data: null }).store.list()).toEqual([]);
  });

  it("181-S1: a failed read is thrown, so the service answers 500", async () => {
    const { store } = storeWith({ error: { code: "XX000", message: "boom" } });

    await expect(store.list()).rejects.toThrow("Reading the layout types failed: boom");
  });
});
