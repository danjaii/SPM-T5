import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { EquipmentInput } from "@spm-t5/shared";
import { ServiceError } from "../../src/domain/errors";
import { SupabaseEquipmentCatalogueStore } from "../../src/repositories/equipmentCatalogueStore";

const ID = "2cde28cc-997e-58d3-8b9a-21b6938a81d4";

const input: EquipmentInput = {
  name: "Projector Unit",
  type: "AV",
  description: null,
  totalQuantity: 10,
  location: "Central Equipment Store",
  operationalStatus: "under_maintenance",
};

type Reply = { data?: unknown; error?: { code: string; message: string; hint?: string } | null };

function storeWith(reply: Reply) {
  const rpc = vi.fn(async () => ({ data: reply.data ?? null, error: reply.error ?? null }));
  const order = vi.fn(async () => ({ data: reply.data ?? null, error: reply.error ?? null }));
  const select = vi.fn(() => ({ order }));
  const from = vi.fn(() => ({ select }));
  return { rpc, from, select, order, store: new SupabaseEquipmentCatalogueStore({ rpc, from } as unknown as SupabaseClient) };
}

describe("SCRUM-182/AC1 the create_equipment call (182-S1)", () => {
  it("182-S1: sends the cleaned values to create_equipment and returns the new id", async () => {
    const { rpc, store } = storeWith({ data: { id: ID } });

    expect(await store.create(input)).toEqual({ id: ID });
    expect(rpc).toHaveBeenCalledWith("create_equipment", {
      p_name: "Projector Unit",
      p_type: "AV",
      p_description: null,
      p_total_quantity: 10,
      p_location: "Central Equipment Store",
    });
  });
});

describe("SCRUM-182/AC2,AC3 the update_equipment call (182-S2, S3)", () => {
  it("182-S2: sends the id, the values and the status to update_equipment", async () => {
    const { rpc, store } = storeWith({ data: { id: ID } });

    expect(await store.update(ID, input)).toEqual({ id: ID });
    expect(rpc).toHaveBeenCalledWith("update_equipment", {
      p_id: ID,
      p_name: "Projector Unit",
      p_type: "AV",
      p_description: null,
      p_total_quantity: 10,
      p_location: "Central Equipment Store",
      p_status: "under_maintenance",
    });
  });
});

describe("SCRUM-182/AC4,AC5 what the database refuses becomes the right answer", () => {
  it.each([
    ["add", (s: SupabaseEquipmentCatalogueStore) => s.create(input)],
    ["edit", (s: SupabaseEquipmentCatalogueStore) => s.update(ID, input)],
  ] as const)("182-S5: the role check in the database is a 403 on %s", async (_verb, call) => {
    const { store } = storeWith({ error: { code: "42501", message: "nope" } });

    await expect(call(store)).rejects.toMatchObject({ httpStatus: 403, code: "FORBIDDEN" });
  });

  it("182-S2: an unknown id is a 404", async () => {
    const { store } = storeWith({ error: { code: "P0002", message: "Equipment not found." } });

    await expect(store.update(ID, input)).rejects.toMatchObject({ httpStatus: 404, code: "NOT_FOUND" });
  });

  it("182-S4: a refused field is a 422 on the field the database names, with its reason", async () => {
    const { store } = storeWith({ error: { code: "22023", message: "Quantity must be a whole number from 1 to 100000.", hint: "totalQuantity" } });

    await expect(store.create(input)).rejects.toMatchObject({
      httpStatus: 422,
      fieldErrors: { totalQuantity: "Quantity must be a whole number from 1 to 100000." },
    });
  });

  it("182-S4: any other database error is thrown as it is, so the service answers 500 without details", async () => {
    for (const reply of [{ error: { code: "XX000", message: "boom" } }, { error: { code: "22023", message: "no hint" } }]) {
      const failure = await storeWith(reply).store.create(input).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(ServiceError);
    }
  });
});

describe("SCRUM-182/AC1,AC2 the list of items (182-S1, S2)", () => {
  it("182-S1: reads every item by name with every detail the page shows", async () => {
    const { from, select, order, store } = storeWith({
      data: [
        { id: ID, name: "Projector Unit", type: "AV", description: "1080p", total_quantity: 10, location: "Store", operational_status: "available" },
        { id: "e2", name: "Cable Reel", type: null, description: null, total_quantity: 25, location: null, operational_status: "retired" },
      ],
    });

    expect(await store.list()).toEqual([
      { id: ID, name: "Projector Unit", type: "AV", description: "1080p", totalQuantity: 10, location: "Store", operationalStatus: "available" },
      { id: "e2", name: "Cable Reel", type: null, description: null, totalQuantity: 25, location: null, operationalStatus: "retired" },
    ]);
    expect(from).toHaveBeenCalledWith("equipment");
    expect(select).toHaveBeenCalledWith("id, name, type, description, total_quantity, location, operational_status");
    expect(order).toHaveBeenCalledWith("name", { ascending: true });
  });

  it("182-S1: no rows is an empty list, and a failed read is thrown so the service answers 500", async () => {
    expect(await storeWith({ data: null }).store.list()).toEqual([]);

    await expect(storeWith({ error: { code: "XX000", message: "boom" } }).store.list()).rejects.toThrow(
      "Reading the equipment catalogue failed: boom",
    );
  });
});
