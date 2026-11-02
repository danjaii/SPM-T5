import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { SupabaseEquipmentCatalogueStore } from "../../src/repositories/equipmentCatalogueStore";
import { SupabaseEquipmentReader } from "../../src/readers/equipmentReader";
import { adminClient, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-182 (docs/specs/equipment-catalogue-maintenance.md): create_equipment and update_equipment (migration 78) let Technical
 * Support Staff add and edit equipment and change an item's operational status. Every check signs in as a seeded user, so it goes
 * through the same JWT + publishable-key path the services use. Items made here are named "IT-182-..." and are removed afterwards;
 * the seeded items are never changed, because other suites depend on them. Assertions only cover rows these tests create, never a
 * count of a whole table (CLAUDE.md, SCRUM-143).
 */
const EMAILS = {
  organiser: "jason.chua@techconnect.example.com",
  coordinator: "rachel.tan@connectsphere.example.com",
  lead: "helen.ong@connectsphere.example.com",
  venueStaff: "kenneth.wong@connectsphere.example.com",
  technicalSupport: "aaron.koh@connectsphere.example.com",
  safetyOfficer: "farah.ismail@connectsphere.example.com",
  attendee: "alicia.fernandez@example.com",
};
type Who = keyof typeof EMAILS;
type Actor = Awaited<ReturnType<typeof signInAs>>;

const DENIED = "42501";
const NO_SUCH_ITEM = "P0002";
const INVALID_FIELD = "22023";
const NIL_ID = "00000000-0000-0000-0000-000000000000";

const tag = () => Math.random().toString(36).slice(2, 8);

describe.skipIf(!hasDb)("SCRUM-182 Technical Support Staff maintain the equipment catalogue (migration 78)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<Who, Actor>;
  const everyone = Object.keys(EMAILS) as Who[];
  const notTechnicalSupport = everyone.filter((r) => r !== "technicalSupport");
  const prefix = `IT-182-${tag()}`;
  const eventIds: string[] = [];

  beforeAll(async () => {
    for (const key of everyone) who[key] = await signInAs(EMAILS[key]);
  });

  afterAll(async () => {
    const { data } = await admin.from("equipment").select("id").ilike("name", `${prefix}%`);
    const ids = (data ?? []).map((i) => i.id as string);
    if (eventIds.length) {
      await admin.from("equipment_reservations").delete().in("event_id", eventIds);
      await admin.from("events").delete().in("id", eventIds);
    }
    if (ids.length) {
      await admin.from("equipment_reservations").delete().in("equipment_id", ids);
      await admin.from("equipment").delete().in("id", ids);
    }
    // The audit rows stay when an item does; find the ones these tests made by what they say.
    await admin.from("activity_log").delete().like("action_type", "equipment_%").ilike("description", `%${prefix}%`);
  });

  const create = (actor: Actor, name: string, extra: Record<string, unknown> = {}) =>
    actor.client.rpc("create_equipment", {
      p_name: name,
      p_type: "AV",
      p_description: "A test item.",
      p_total_quantity: 5,
      p_location: "Test store",
      ...extra,
    });

  const update = (actor: Actor, id: string, extra: Record<string, unknown> = {}) =>
    actor.client.rpc("update_equipment", {
      p_id: id,
      p_name: `${prefix}-edited`,
      p_type: "AV",
      p_description: "A test item.",
      p_total_quantity: 5,
      p_location: "Test store",
      p_status: "available",
      ...extra,
    });

  /** A throwaway item made by Technical Support Staff, the way the app makes one. */
  const newItem = async (suffix: string, extra: Record<string, unknown> = {}): Promise<{ id: string; name: string }> => {
    const name = `${prefix}-${suffix}`;
    const { data, error } = await create(who.technicalSupport, name, extra);
    if (error) throw new Error(error.message);
    return { id: (data as { id: string }).id, name };
  };

  const row = async (id: string) => {
    const { data, error } = await admin.from("equipment").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  };

  const auditRows = async (id: string) => {
    const { data, error } = await admin.from("activity_log").select("action_type, actor_id, description").eq("entity_id", id).order("created_at");
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  /** What the reservation form's availability reader and the free-units rule say about an item. */
  const freeUnits = async (id: string) => {
    const { data, error } = await admin.rpc("equipment_free_units", {
      p_equipment_id: id,
      p_start: "2031-06-15T01:00:00Z",
      p_end: "2031-06-15T09:00:00Z",
    });
    if (error) throw new Error(error.message);
    return data as number;
  };

  describe("SCRUM-182/AC1 an item is added and shows up (182-S1)", () => {
    it("182-S1: the new item has the cleaned values, starts available, and is logged with who added it", async () => {
      const { data, error } = await create(who.technicalSupport, `  ${prefix}-clean   spaces  `, { p_type: "  Audio ", p_description: "  ", p_location: " Store  B " });
      expect(error).toBeNull();
      const id = (data as { id: string }).id;

      expect(await row(id)).toMatchObject({
        name: `${prefix}-clean spaces`,
        type: "Audio",
        description: null,
        total_quantity: 5,
        location: "Store B",
        operational_status: "available",
      });
      expect(await auditRows(id)).toEqual([
        { action_type: "equipment_created", actor_id: who.technicalSupport.userId, description: `Added equipment "${prefix}-clean spaces" (5 units)` },
      ]);
    });

    it("182-S1: the new item is in the catalogue list and in the availability check's catalogue with its units free", async () => {
      const item = await newItem("shows-up", { p_total_quantity: 7 });

      const list = await new SupabaseEquipmentCatalogueStore(who.technicalSupport.client).list();
      expect(list.find((i) => i.id === item.id)).toEqual({
        id: item.id,
        name: item.name,
        type: "AV",
        description: "A test item.",
        totalQuantity: 7,
        location: "Test store",
        operationalStatus: "available",
      });

      const catalogue = await new SupabaseEquipmentReader(who.technicalSupport.client).list();
      expect(catalogue.find((i) => i.id === item.id)).toMatchObject({ name: item.name, totalQuantity: 7, operationalStatus: "available" });
      expect(await freeUnits(item.id)).toBe(7);
    });

    it("182-S1: only the required details are enough, and a blank optional detail is stored as null", async () => {
      const item = await newItem("required-only", { p_type: null, p_description: null, p_location: null });

      expect(await row(item.id)).toMatchObject({ type: null, description: null, location: null });
    });
  });

  describe("SCRUM-182/AC2 an item's details are changed (182-S2)", () => {
    it("182-S2: the new values are saved and shown in the list, and the change is logged", async () => {
      const item = await newItem("edit-me");

      const { data, error } = await update(who.technicalSupport, item.id, {
        p_name: `  ${prefix}-edited   name `,
        p_type: "Lighting",
        p_description: null,
        p_total_quantity: 9,
        p_location: "Store C",
      });

      expect(error).toBeNull();
      expect(data).toEqual({ id: item.id });
      expect(await row(item.id)).toMatchObject({
        name: `${prefix}-edited name`,
        type: "Lighting",
        description: null,
        total_quantity: 9,
        location: "Store C",
        operational_status: "available",
      });
      const list = await new SupabaseEquipmentCatalogueStore(who.technicalSupport.client).list();
      expect(list.find((i) => i.id === item.id)).toMatchObject({ name: `${prefix}-edited name`, totalQuantity: 9 });
      const log = await auditRows(item.id);
      expect(log).toHaveLength(2);
      expect(log[1]).toMatchObject({ action_type: "equipment_updated", actor_id: who.technicalSupport.userId });
      expect(log[1].description).toContain("quantity 5 to 9");
      expect(log[1].description).toContain(`name "${item.name}" to "${prefix}-edited name"`);
      expect(log[1].description).toContain("type");
      expect(log[1].description).toContain("description");
    });

    it("182-S2: saving without changing anything writes nothing and no audit row", async () => {
      const item = await newItem("no-change");
      const before = await auditRows(item.id);

      const { error } = await update(who.technicalSupport, item.id, { p_name: item.name });

      expect(error).toBeNull();
      expect(await auditRows(item.id)).toEqual(before);
    });

    it("182-S2: an unknown id is P0002 and nothing is written", async () => {
      const { error } = await update(who.technicalSupport, NIL_ID);

      expect(error?.code).toBe(NO_SUCH_ITEM);
    });
  });

  describe("SCRUM-182/AC3 a status change takes an item out of the availability check (182-S3)", () => {
    it.each(["under_maintenance", "damaged", "retired"] as const)("182-S3: marking an item %s leaves it with no free units, and available again frees them", async (status) => {
      const item = await newItem(`status-${status}`, { p_total_quantity: 4 });
      expect(await freeUnits(item.id)).toBe(4);

      const marked = await update(who.technicalSupport, item.id, { p_name: item.name, p_total_quantity: 4, p_status: status });
      expect(marked.error).toBeNull();
      expect((await row(item.id))?.operational_status).toBe(status);
      expect(await freeUnits(item.id)).toBe(0);
      const reader = await new SupabaseEquipmentReader(who.technicalSupport.client).list();
      expect(reader.find((i) => i.id === item.id)?.operationalStatus).toBe(status);

      const back = await update(who.technicalSupport, item.id, { p_name: item.name, p_total_quantity: 4, p_status: "available" });
      expect(back.error).toBeNull();
      expect(await freeUnits(item.id)).toBe(4);

      const log = await auditRows(item.id);
      expect(log.map((r) => r.action_type)).toEqual(["equipment_created", "equipment_status_changed", "equipment_status_changed"]);
      expect(log[1].description).toContain(`status available to ${status}`);
    });

    it("182-S3: a reservation for an item that is under maintenance is refused", async () => {
      const item = await newItem("no-reserve", { p_total_quantity: 4 });
      await update(who.technicalSupport, item.id, { p_name: item.name, p_total_quantity: 4, p_status: "under_maintenance" });
      const { data: organiser } = await admin.from("users").select("id").eq("role", "event_organiser").limit(1).single();
      const event = await admin
        .from("events")
        .insert({ name: `${prefix}-event`, organiser_id: organiser!.id, status: "approved", is_draft: false, expected_attendance: 20 })
        .select("id")
        .single();
      eventIds.push(event.data!.id as string);

      const { data, error } = await who.technicalSupport.client.rpc("reserve_equipment", {
        p_event_id: event.data!.id,
        p_equipment_id: item.id,
        p_quantity: 1,
        p_start: "2031-06-15T01:00:00Z",
        p_end: "2031-06-15T09:00:00Z",
      });

      // reserve_equipment answers { ok: false, available: 0 } when nothing is free, rather than raising
      expect(error).toBeNull();
      expect(data).toEqual([expect.objectContaining({ ok: false, available: 0 })]);
      const held = await admin.from("equipment_reservations").select("id").eq("equipment_id", item.id);
      expect(held.data).toEqual([]);
    });

    it("182-S3: a status that is not one of the four is refused on the status field", async () => {
      const item = await newItem("bad-status");

      const { error } = await update(who.technicalSupport, item.id, { p_name: item.name, p_status: "broken" });

      expect(error?.code).toBe(INVALID_FIELD);
      expect(error?.hint).toBe("operationalStatus");
      expect((await row(item.id))?.operational_status).toBe("available");
    });

    it("182-S3: an edit that leaves the status out is refused too, so it cannot put a damaged item back in service", async () => {
      const item = await newItem("no-status");
      await update(who.technicalSupport, item.id, { p_name: item.name, p_status: "damaged" });

      const { error } = await update(who.technicalSupport, item.id, { p_name: item.name, p_status: null });

      expect(error?.code).toBe(INVALID_FIELD);
      expect((await row(item.id))?.operational_status).toBe("damaged");
    });
  });

  describe("SCRUM-182/AC4 required and invalid fields (182-S4)", () => {
    it.each([
      [a blank name, name, { p_name: "   " }],
      [a name over 120 characters, name, { p_name: "x".repeat(121) }],
      [a type over 60 characters, type, { p_type: "x".repeat(61) }],
      [a description over 500 characters, description, { p_description: "x".repeat(501) }],
      [a location over 120 characters, location, { p_location: "x".repeat(121) }],
      [a quantity of zero, totalQuantity, { p_total_quantity: 0 }],
      [a negative quantity, totalQuantity, { p_total_quantity: -2 }],
      [a quantity over 100000, totalQuantity, { p_total_quantity: 100001 }],
      [no quantity, totalQuantity, { p_total_quantity: null }],
    ])("182-S4: %s is refused on the %s field on add and on edit, and nothing is written", async (_label, field, extra) => {
      const item = await newItem(`invalid-${tag()}`);
      const added = `${prefix}-never-${tag()}`;

      const add = await create(who.technicalSupport, "p_name" in extra ? (extra.p_name as string) : added, extra);
      const edit = await update(who.technicalSupport, item.id, { p_name: item.name, ...extra });

      for (const r of [add, edit]) {
        expect(r.error?.code).toBe(INVALID_FIELD);
        expect(r.error?.hint).toBe(field);
      }
      expect((await admin.from("equipment").select("id").eq("name", added)).data).toEqual([]);
      expect(await row(item.id)).toMatchObject({ name: item.name, total_quantity: 5 });
    });

    it("182-S4: the database holds a direct write to the quantity rule too (the schema's own check)", async () => {
      const { error } = await admin.from("equipment").insert({ name: `${prefix}-direct`, total_quantity: -1 });

      expect(error?.code).toBe("23514");
    });
  });

  describe("SCRUM-182/AC5 only technical support staff (182-S5)", () => {
    it.each(notTechnicalSupport)("182-S5: %s is refused by both functions and nothing changes", async (key) => {
      const item = await newItem(`no-${key}`);
      const added = `${prefix}-refused-${key}`;

      expect((await create(who[key], added)).error?.code).toBe(DENIED);
      expect((await update(who[key], item.id, { p_name: added })).error?.code).toBe(DENIED);

      expect((await row(item.id))?.name).toBe(item.name);
      expect((await admin.from("equipment").select("id").eq("name", added)).data).toEqual([]);
    });

    it.each(notTechnicalSupport)("182-S5: %s cannot insert or change equipment directly either", async (key) => {
      const item = await newItem(`direct-${key}`);
      const name = `${prefix}-direct-by-${key}`;

      const insert = await who[key].client.from("equipment").insert({ name, total_quantity: 1 });
      await who[key].client.from("equipment").update({ operational_status: "retired" }).eq("id", item.id);

      expect(insert.error?.code).toBe(DENIED);
      expect((await row(item.id))?.operational_status).toBe("available");
      expect((await admin.from("equipment").select("id").eq("name", name)).data).toEqual([]);
    });

    it("182-S5: a visitor who is not signed in cannot call the functions", async () => {
      const item = await newItem("visitor");
      const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });

      const results = await Promise.all([
        anon.rpc("create_equipment", { p_name: `${prefix}-visitor-new`, p_type: null, p_description: null, p_total_quantity: 1, p_location: null }),
        anon.rpc("update_equipment", { p_id: item.id, p_name: "x", p_type: null, p_description: null, p_total_quantity: 1, p_location: null, p_status: "retired" }),
      ]);

      for (const r of results) expect(r.error).not.toBeNull();
      expect((await row(item.id))?.operational_status).toBe("available");
      expect((await admin.from("equipment").select("id").eq("name", `${prefix}-visitor-new`)).data).toEqual([]);
    });
  });
});
