import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { SupabaseLayoutTypeStore } from "../../src/readers/layoutTypeStore";
import { SupabaseVenueSearchReader } from "../../src/readers/venueSearchReader";
import { adminClient, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-181 (docs/specs/layout-type-maintenance.md): create_layout_type, rename_layout_type and delete_layout_type
 * (migration 75) let Venue Staff add, rename and delete room layout types. Every check signs in as a seeded user, so it goes
 * through the same JWT + publishable-key path the services use. Layout types made here are named "IT-181-..." and are
 * removed afterwards; the seeded layouts (Theatre and the others) are never renamed or deleted, because other suites depend
 * on them. Assertions only cover rows these tests create, never a count of a whole table (CLAUDE.md, SCRUM-143).
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
const NO_SUCH_LAYOUT_TYPE = "P0002";
const INVALID_NAME = "22023";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const UNKNOWN_LAYOUT = "CS571";
const NIL_ID = "00000000-0000-0000-0000-000000000000";

const tag = () => Math.random().toString(36).slice(2, 8);

describe.skipIf(!hasDb)("SCRUM-181 Venue Staff maintain layout types (migration 75)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<Who, Actor>;
  const everyone = Object.keys(EMAILS) as Who[];
  const notVenueStaff = everyone.filter((r) => r !== "venueStaff");
  const prefix = `IT-181-${tag()}`;
  const venueIds: string[] = [];
  const eventIds: string[] = [];

  beforeAll(async () => {
    for (const key of everyone) who[key] = await signInAs(EMAILS[key]);
  });

  afterAll(async () => {
    const { data: layouts } = await admin.from("room_layouts").select("id").ilike("name", `${prefix}%`); // not like: the case-change test leaves an upper-case name behind
    const layoutIds = (layouts ?? []).map((l) => l.id as string);
    if (eventIds.length) await admin.from("events").delete().in("id", eventIds);
    if (venueIds.length) {
      await admin.from("activity_log").delete().in("entity_id", venueIds);
      await admin.from("venues").delete().in("id", venueIds); // the venue's layout links go with it (on delete cascade)
    }
    if (layoutIds.length) await admin.from("room_layouts").delete().in("id", layoutIds);
    // The audit row of a deleted layout type stays by design (181-S3), so find these by what they say: every one names a
    // layout type this run made, and each of those names starts with the prefix.
    await admin.from("activity_log").delete().like("action_type", "layout_type_%").ilike("description", `%${prefix}%`);
  });

  const create = (actor: Actor, name: string) => actor.client.rpc("create_layout_type", { p_name: name });
  const rename = (actor: Actor, id: string, name: string) => actor.client.rpc("rename_layout_type", { p_id: id, p_name: name });
  const remove = (actor: Actor, id: string) => actor.client.rpc("delete_layout_type", { p_id: id });

  /** A throwaway layout type made by Venue Staff, the way the app makes one. */
  const newType = async (suffix: string): Promise<{ id: string; name: string }> => {
    const { data, error } = await create(who.venueStaff, `${prefix}-${suffix}`);
    if (error) throw new Error(error.message);
    return data as { id: string; name: string };
  };

  /** A throwaway venue that supports the given layout type, made by Venue Staff (so it also goes through create_venue). */
  const venueUsing = async (layoutId: string, suffix: string, extra: Record<string, unknown> = {}): Promise<{ id: string; name: string }> => {
    const name = `${prefix}-venue-${suffix}`;
    const { data, error } = await who.venueStaff.client.rpc("create_venue", {
      p_name: name,
      p_address: "1 Test Road",
      p_description: null,
      p_max_capacity: 120,
      p_hours_start: null,
      p_hours_end: null,
      p_is_accessible: false,
      p_accessibility_notes: null,
      p_layouts: [{ layout_id: layoutId, max_capacity: 90 }],
      p_facility_ids: [],
      ...extra,
    });
    if (error) throw new Error(error.message);
    venueIds.push(data as string);
    return { id: data as string, name };
  };

  const layoutRow = async (id: string) => {
    const { data, error } = await admin.from("room_layouts").select("id, name").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  };

  const auditRows = async (id: string) => {
    const { data, error } = await admin.from("activity_log").select("action_type, actor_id, description").eq("entity_id", id).order("created_at");
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  describe("SCRUM-181/AC1 venue staff add a layout type (181-S1)", () => {
    it("181-S1: the new type has the cleaned name, is active, and is logged with who added it", async () => {
      const { data, error } = await create(who.venueStaff, `  ${prefix}-clean   spaces  `);
      expect(error).toBeNull();
      expect(data).toEqual({ id: expect.any(String), name: `${prefix}-clean spaces` });

      const row = await admin.from("room_layouts").select("name, is_active").eq("id", data.id).single();
      expect(row.data).toEqual({ name: `${prefix}-clean spaces`, is_active: true });
      expect(await auditRows(data.id)).toEqual([
        { action_type: "layout_type_created", actor_id: who.venueStaff.userId, description: `Added layout type "${prefix}-clean spaces"` },
      ]);
    });

    it("181-S1: the new type is in the list with no venues, and in the layout choices for adding or editing a venue", async () => {
      const type = await newType("choices");

      const list = await new SupabaseLayoutTypeStore(who.venueStaff.client).list();
      expect(list.find((t) => t.id === type.id)).toEqual({ id: type.id, name: type.name, isActive: true, venueCount: 0 });

      const options = await new SupabaseVenueSearchReader(who.venueStaff.client).options();
      expect(options.layouts).toContainEqual({ id: type.id, name: type.name });
    });

    it("181-S1: the list counts the venues that support a type, active or not", async () => {
      const type = await newType("count");
      await venueUsing(type.id, "count-a");
      const inactive = await venueUsing(type.id, "count-b");
      await admin.from("venues").update({ is_active: false }).eq("id", inactive.id);

      const list = await new SupabaseLayoutTypeStore(who.venueStaff.client).list();
      expect(list.find((t) => t.id === type.id)?.venueCount).toBe(2);
    });
  });

  describe("SCRUM-181/AC2 venue staff rename a layout type (181-S2)", () => {
    it("181-S2: a venue that uses the type shows the new name and keeps its capacity for the layout", async () => {
      const type = await newType("rename-from");
      const venue = await venueUsing(type.id, "rename");
      const newName = `${prefix}-rename-to`;

      const { data, error } = await rename(who.venueStaff, type.id, `  ${newName} `);
      expect(error).toBeNull();
      expect(data).toEqual({ id: type.id, name: newName });

      const links = await admin
        .from("venue_supported_layouts")
        .select("room_layout_id, max_capacity_for_layout, room_layouts(name)")
        .eq("venue_id", venue.id);
      expect(links.data).toEqual([{ room_layout_id: type.id, max_capacity_for_layout: 90, room_layouts: { name: newName } }]);
      expect(await auditRows(type.id)).toEqual([
        expect.objectContaining({ action_type: "layout_type_created" }),
        { action_type: "layout_type_renamed", actor_id: who.venueStaff.userId, description: `Renamed layout type "${type.name}" to "${newName}"` },
      ]);
    });

    it("181-S2: changing only the case of its own name is allowed", async () => {
      const type = await newType("case-change");
      const { data, error } = await rename(who.venueStaff, type.id, type.name.toUpperCase());
      expect(error).toBeNull();
      expect(data.name).toBe(type.name.toUpperCase());
    });

    it("181-S2: the same name again changes nothing and writes no audit row", async () => {
      const type = await newType("same-name");
      const before = await auditRows(type.id);

      const { data, error } = await rename(who.venueStaff, type.id, type.name);

      expect(error).toBeNull();
      expect(data).toEqual({ id: type.id, name: type.name });
      expect(await auditRows(type.id)).toEqual(before);
    });

    it("181-S2: an unknown id is P0002 and nothing is written", async () => {
      const { error } = await rename(who.venueStaff, NIL_ID, `${prefix}-nobody`);
      expect(error?.code).toBe(NO_SUCH_LAYOUT_TYPE);
      expect((await admin.from("room_layouts").select("id").eq("name", `${prefix}-nobody`)).data).toHaveLength(0);
    });
  });

  describe("SCRUM-181/AC3 venue staff delete a layout type nothing uses (181-S3)", () => {
    it("181-S3: the type is gone from the table, the list and the layout choices, and the audit row stays", async () => {
      const type = await newType("delete-me");

      const { data, error } = await remove(who.venueStaff, type.id);

      expect(error).toBeNull();
      expect(data).toEqual({ deleted: true, name: type.name });
      expect(await layoutRow(type.id)).toBeNull();
      expect((await new SupabaseLayoutTypeStore(who.venueStaff.client).list()).some((t) => t.id === type.id)).toBe(false);
      expect((await new SupabaseVenueSearchReader(who.venueStaff.client).options()).layouts.some((l) => l.id === type.id)).toBe(false);
      expect(await auditRows(type.id)).toEqual([
        expect.objectContaining({ action_type: "layout_type_created" }),
        { action_type: "layout_type_deleted", actor_id: who.venueStaff.userId, description: `Deleted layout type "${type.name}"` },
      ]);
    });

    it("181-S3: an unknown id is P0002", async () => {
      const { error } = await remove(who.venueStaff, NIL_ID);
      expect(error?.code).toBe(NO_SUCH_LAYOUT_TYPE);
    });
  });

  describe("SCRUM-181/AC4 a layout type in use cannot be deleted (181-S4)", () => {
    it("181-S4: a type a venue supports is refused naming every such venue, inactive ones too, and is still there", async () => {
      const type = await newType("in-use");
      const active = await venueUsing(type.id, "use-a");
      const inactive = await venueUsing(type.id, "use-b");
      await admin.from("venues").update({ is_active: false }).eq("id", inactive.id);

      const { data, error } = await remove(who.venueStaff, type.id);

      expect(error).toBeNull();
      expect(data).toEqual({
        deleted: false,
        name: type.name,
        venues: [
          { id: active.id, name: active.name },
          { id: inactive.id, name: inactive.name },
        ],
        event_count: 0,
      });
      expect(await layoutRow(type.id)).not.toBeNull();
      expect((await auditRows(type.id)).map((r) => r.action_type)).toEqual(["layout_type_created"]);
    });

    it("181-S4: the service turns the refusal into a 409 that names the venues", async () => {
      const type = await newType("in-use-409");
      const venue = await venueUsing(type.id, "use-409");

      const failure = await new SupabaseLayoutTypeStore(who.venueStaff.client).remove(type.id).catch((e: unknown) => e);

      expect(failure).toMatchObject({
        httpStatus: 409,
        code: "LAYOUT_TYPE_IN_USE",
        message: `"${type.name}" cannot be deleted because 1 venue uses it: ${venue.name}.`,
        usedBy: { venues: [{ id: venue.id, name: venue.name }], eventCount: 0 },
      });
    });

    it("181-S4: a type only an event request or draft prefers is refused with the count and no event name", async () => {
      const type = await newType("event-use");
      const organiser = who.organiser.userId;
      for (const isDraft of [false, true]) {
        const { data, error } = await admin
          .from("events")
          .insert({
            name: `${prefix}-event-${isDraft ? "draft" : "request"}`,
            organiser_id: organiser,
            status: isDraft ? "draft" : "submitted",
            is_draft: isDraft,
            expected_attendance: 20,
            preferred_room_layout_id: type.id,
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        eventIds.push(data.id as string);
      }

      const { data, error } = await remove(who.venueStaff, type.id);

      expect(error).toBeNull();
      expect(data).toEqual({ deleted: false, name: type.name, venues: [], event_count: 2 });
      expect(JSON.stringify(data)).not.toContain(`${prefix}-event-draft`);
      expect(JSON.stringify(data)).not.toContain(`${prefix}-event-request`);
      expect(await layoutRow(type.id)).not.toBeNull();
    });

    it("181-S4: once the last venue drops the type, the delete goes through", async () => {
      const type = await newType("freed");
      const venue = await venueUsing(type.id, "freed");
      expect((await remove(who.venueStaff, type.id)).data.deleted).toBe(false);

      const drop = await admin.from("venue_supported_layouts").delete().eq("venue_id", venue.id).eq("room_layout_id", type.id);
      expect(drop.error).toBeNull();

      const { data, error } = await remove(who.venueStaff, type.id);
      expect(error).toBeNull();
      expect(data).toEqual({ deleted: true, name: type.name });
    });

    it("181-S4: a venue edit that names a deleted type is refused (CS571) and changes nothing", async () => {
      const keep = await newType("kept");
      const gone = await newType("gone");
      const venue = await venueUsing(keep.id, "edit-after-delete");
      expect((await remove(who.venueStaff, gone.id)).data.deleted).toBe(true);

      const { error } = await who.venueStaff.client.rpc("update_venue", {
        p_venue_id: venue.id,
        p_name: `${venue.name}-changed`,
        p_address: "1 Test Road",
        p_description: null,
        p_max_capacity: 120,
        p_hours_start: null,
        p_hours_end: null,
        p_is_accessible: false,
        p_accessibility_notes: null,
        p_layouts: [{ layout_id: gone.id, max_capacity: 90 }],
        p_facility_ids: [],
      });

      expect(error?.code).toBe(UNKNOWN_LAYOUT);
      const after = await admin.from("venues").select("name").eq("id", venue.id).single();
      expect(after.data?.name).toBe(venue.name);
      const links = await admin.from("venue_supported_layouts").select("room_layout_id").eq("venue_id", venue.id);
      expect(links.data).toEqual([{ room_layout_id: keep.id }]);
    });
  });

  describe("SCRUM-181/AC5 empty and duplicate names (181-S5)", () => {
    it.each([
      ["an empty name", ""],
      ["a blank name", "   "],
      ["a name over 60 characters", "x".repeat(61)],
    ])("181-S5: %s is refused on add and on rename, and nothing changes", async (_label, name) => {
      const type = await newType(`invalid-${tag()}`);

      expect((await create(who.venueStaff, name)).error?.code).toBe(INVALID_NAME);
      expect((await rename(who.venueStaff, type.id, name)).error?.code).toBe(INVALID_NAME);
      expect((await layoutRow(type.id))?.name).toBe(type.name);
    });

    it("181-S5: a name another type has, ignoring case and spacing, is refused on add and on rename", async () => {
      const first = await newType("dup-first");
      const second = await newType("dup-second");

      const add = await create(who.venueStaff, `  ${first.name.toUpperCase()}  `);
      const clash = await rename(who.venueStaff, second.id, first.name.toLowerCase());

      expect(add.error?.code).toBe(UNIQUE_VIOLATION);
      expect(clash.error?.code).toBe(UNIQUE_VIOLATION);
      expect((await layoutRow(second.id))?.name).toBe(second.name);
      expect((await admin.from("room_layouts").select("id").ilike("name", first.name)).data).toHaveLength(1);
    });

    it("181-S5: the database holds a direct write to the same rule, a duplicate ignoring case and a blank name", async () => {
      const type = await newType("direct");

      const duplicate = await admin.from("room_layouts").insert({ name: type.name.toUpperCase() });
      const blank = await admin.from("room_layouts").insert({ name: "   " });

      expect(duplicate.error?.code).toBe(UNIQUE_VIOLATION);
      expect(blank.error?.code).toBe(CHECK_VIOLATION);
    });
  });

  describe("SCRUM-181/AC6 only venue staff (181-S6)", () => {
    it.each(notVenueStaff)("181-S6: %s is refused by all three functions and nothing changes", async (key) => {
      const type = await newType(`no-${key}`);
      const name = `${prefix}-refused-${key}`;

      expect((await create(who[key], name)).error?.code).toBe(DENIED);
      expect((await rename(who[key], type.id, name)).error?.code).toBe(DENIED);
      expect((await remove(who[key], type.id)).error?.code).toBe(DENIED);

      expect((await layoutRow(type.id))?.name).toBe(type.name);
      expect((await admin.from("room_layouts").select("id").eq("name", name)).data).toHaveLength(0);
    });

    it.each(notVenueStaff)("181-S6: %s cannot insert, rename or delete a layout type directly either", async (key) => {
      const type = await newType(`direct-${key}`);
      const name = `${prefix}-direct-by-${key}`;

      const insert = await who[key].client.from("room_layouts").insert({ name });
      await who[key].client.from("room_layouts").update({ name }).eq("id", type.id);
      await who[key].client.from("room_layouts").delete().eq("id", type.id);

      expect(insert.error?.code).toBe(DENIED);
      expect((await layoutRow(type.id))?.name).toBe(type.name);
      expect((await admin.from("room_layouts").select("id").eq("name", name)).data).toHaveLength(0);
    });

    it("181-S6: a visitor who is not signed in cannot call the functions", async () => {
      const type = await newType("visitor");
      const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });

      const results = await Promise.all([
        anon.rpc("create_layout_type", { p_name: `${prefix}-visitor-new` }),
        anon.rpc("rename_layout_type", { p_id: type.id, p_name: `${prefix}-visitor-renamed` }),
        anon.rpc("delete_layout_type", { p_id: type.id }),
      ]);

      for (const r of results) expect(r.error).not.toBeNull();
      expect((await layoutRow(type.id))?.name).toBe(type.name);
      expect((await admin.from("room_layouts").select("id").eq("name", `${prefix}-visitor-new`)).data).toHaveLength(0);
    });
  });
});
