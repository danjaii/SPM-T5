import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { adminClient, DB_ENV, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-155 (docs/specs/catalogue-write-roles.md): catalogue writes follow the owning role (migration 53). Every check
 * signs in as a seeded user, so it goes through the same JWT + publishable-key path the services use. Fixtures are
 * created with the secret key (which bypasses RLS), are prefixed "IT-" and are removed afterwards. Assertions only cover
 * rows these tests create, never a count of a whole table (CLAUDE.md, SCRUM-143).
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

/** Postgres "insufficient_privilege": a missing grant, or an RLS WITH CHECK failure. */
const DENIED = "42501";
/** Postgres "foreign_key_violation". */
const IN_USE = "23503";

const tag = () => Math.random().toString(36).slice(2, 8);

describe.skipIf(!hasDb)("SCRUM-155 catalogue writes follow the owning role (migration 53)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  const who = {} as Record<Who, Actor>;
  const everyone = Object.keys(EMAILS) as Who[];
  const notVenueStaff = everyone.filter((r) => r !== "venueStaff");
  const notTechnicalSupport = everyone.filter((r) => r !== "technicalSupport");

  const layoutIds: string[] = [];
  const facilityIds: string[] = [];
  const venueIds: string[] = [];
  const equipmentIds: string[] = [];
  const organisationIds: string[] = [];
  const categoryIds: string[] = [];
  const eventIds: string[] = [];

  let venue: string; // fixture venue with one linked layout and one linked facility
  let linkedLayout: string; // supported by `venue`
  let spareLayout: string; // supported by nobody, so a delete is not stopped by a foreign key
  let linkedFacility: string; // on `venue`
  let spareFacility: string; // on no venue
  let equipment: string;
  let organisation: string;
  let category: string;

  const newLayout = async () => {
    const { data, error } = await admin.from("room_layouts").insert({ name: `IT-155-layout-${tag()}`, description: "orig" }).select("id").single();
    if (error) throw new Error(error.message);
    layoutIds.push(data.id as string);
    return data.id as string;
  };
  const newFacility = async () => {
    const { data, error } = await admin.from("facilities").insert({ name: `IT-155-facility-${tag()}`, description: "orig" }).select("id").single();
    if (error) throw new Error(error.message);
    facilityIds.push(data.id as string);
    return data.id as string;
  };

  beforeAll(async () => {
    for (const key of everyone) who[key] = await signInAs(EMAILS[key]);

    venue = await fixtures.venue("IT-155-venue");
    linkedLayout = await newLayout();
    spareLayout = await newLayout();
    linkedFacility = await newFacility();
    spareFacility = await newFacility();
    const links = await Promise.all([
      admin.from("venue_supported_layouts").insert({ venue_id: venue, room_layout_id: linkedLayout, max_capacity_for_layout: 80 }),
      admin.from("venue_facilities").insert({ venue_id: venue, facility_id: linkedFacility }),
    ]);
    for (const l of links) if (l.error) throw new Error(l.error.message);

    const eq = await admin.from("equipment").insert({ name: `IT-155-equipment-${tag()}`, total_quantity: 5 }).select("id").single();
    if (eq.error) throw new Error(eq.error.message);
    equipment = eq.data.id as string;
    equipmentIds.push(equipment);

    const org = await admin.from("organisations").insert({ name: `IT-155-org-${tag()}` }).select("id").single();
    if (org.error) throw new Error(org.error.message);
    organisation = org.data.id as string;
    organisationIds.push(organisation);

    const cat = await admin.from("event_categories").insert({ name: `IT-155-category-${tag()}` }).select("id").single();
    if (cat.error) throw new Error(cat.error.message);
    category = cat.data.id as string;
    categoryIds.push(category);
  });

  afterAll(async () => {
    if (eventIds.length) await admin.from("events").delete().in("id", eventIds);
    await fixtures.cleanup();
    if (venueIds.length) await admin.from("venues").delete().in("id", venueIds);
    if (layoutIds.length) await admin.from("room_layouts").delete().in("id", layoutIds);
    if (facilityIds.length) await admin.from("facilities").delete().in("id", facilityIds);
    if (equipmentIds.length) await admin.from("equipment").delete().in("id", equipmentIds);
    if (organisationIds.length) await admin.from("organisations").delete().in("id", organisationIds);
    if (categoryIds.length) await admin.from("event_categories").delete().in("id", categoryIds);
  });

  const exists = async (table: string, id: string, column = "id") => {
    const { data } = await admin.from(table).select(column).eq(column, id);
    return (data ?? []).length === 1;
  };

  describe("SCRUM-155/AC1 reads stay open", () => {
    it("155-S1: every role reads the catalogue and lookup tables", async () => {
      for (const key of everyone) {
        const c = who[key].client;
        const reads = await Promise.all([
          c.from("venues").select("id").eq("id", venue),
          c.from("venue_supported_layouts").select("id").eq("venue_id", venue),
          c.from("venue_facilities").select("facility_id").eq("venue_id", venue),
          c.from("room_layouts").select("id").eq("id", linkedLayout),
          c.from("facilities").select("id").eq("id", linkedFacility),
          c.from("equipment").select("id").eq("id", equipment),
          c.from("organisations").select("id").eq("id", organisation),
          c.from("event_categories").select("id").eq("id", category),
        ]);
        for (const r of reads) {
          expect(r.error, key).toBeNull();
          expect(r.data, key).toHaveLength(1);
        }
      }
    });

    it("155-S1: someone who is not signed in reads none of it", async () => {
      const anon = createClient(DB_ENV.url!, DB_ENV.publishableKey!, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data } = await anon.from("venues").select("id").eq("id", venue);
      expect(data ?? []).toHaveLength(0);
      const { data: eq } = await anon.from("equipment").select("id").eq("id", equipment);
      expect(eq ?? []).toHaveLength(0);
    });
  });

  describe("SCRUM-155/AC2 only Venue Staff change venues, layouts and facilities", () => {
    it("155-S2: every other role is refused inserting a venue, a link, a layout type and a facility", async () => {
      for (const key of notVenueStaff) {
        const c = who[key].client;
        const results = await Promise.all([
          c.from("venues").insert({ name: `IT-155-denied-${key}`, address: "1 Test Road", max_capacity: 10 }),
          c.from("venue_supported_layouts").insert({ venue_id: venue, room_layout_id: spareLayout, max_capacity_for_layout: 10 }),
          c.from("venue_facilities").insert({ venue_id: venue, facility_id: spareFacility }),
          c.from("room_layouts").insert({ name: `IT-155-denied-${key}` }),
          c.from("facilities").insert({ name: `IT-155-denied-${key}` }),
        ]);
        for (const r of results) expect(r.error?.code, key).toBe(DENIED);
      }
      // Nothing was created.
      expect((await admin.from("venues").select("id").like("name", "IT-155-denied-%")).data).toEqual([]);
      expect((await admin.from("room_layouts").select("id").like("name", "IT-155-denied-%")).data).toEqual([]);
      expect((await admin.from("facilities").select("id").like("name", "IT-155-denied-%")).data).toEqual([]);
      expect((await admin.from("venue_supported_layouts").select("id").eq("venue_id", venue).eq("room_layout_id", spareLayout)).data).toEqual([]);
      expect((await admin.from("venue_facilities").select("venue_id").eq("venue_id", venue).eq("facility_id", spareFacility)).data).toEqual([]);
    });

    it("155-S3: every other role's updates and deletes change nothing", async () => {
      for (const key of notVenueStaff) {
        const c = who[key].client;
        await c.from("venues").update({ description: `by-${key}`, is_active: false }).eq("id", venue);
        await c.from("venues").delete().eq("id", venue);
        await c.from("venue_supported_layouts").update({ max_capacity_for_layout: 1 }).eq("venue_id", venue);
        await c.from("venue_supported_layouts").delete().eq("venue_id", venue);
        await c.from("venue_facilities").delete().eq("venue_id", venue);
        await c.from("room_layouts").update({ description: `by-${key}` }).eq("id", spareLayout);
        await c.from("room_layouts").delete().eq("id", spareLayout);
        await c.from("facilities").update({ description: `by-${key}` }).eq("id", spareFacility);
        await c.from("facilities").delete().eq("id", spareFacility);
      }
      const v = await admin.from("venues").select("description, is_active").eq("id", venue).single();
      expect(v.data).toEqual({ description: null, is_active: true });
      const link = await admin.from("venue_supported_layouts").select("max_capacity_for_layout").eq("venue_id", venue);
      expect(link.data).toEqual([{ max_capacity_for_layout: 80 }]);
      expect((await admin.from("venue_facilities").select("facility_id").eq("venue_id", venue)).data).toEqual([{ facility_id: linkedFacility }]);
      expect((await admin.from("room_layouts").select("description").eq("id", spareLayout).single()).data).toEqual({ description: "orig" });
      expect((await admin.from("facilities").select("description").eq("id", spareFacility).single()).data).toEqual({ description: "orig" });
    });
  });

  describe("SCRUM-155/AC3 Venue Staff maintain venues, layouts and facilities", () => {
    it("155-S4: Venue Staff add, edit and delete a layout type and a facility", async () => {
      const c = who.venueStaff.client;

      const layout = await c.from("room_layouts").insert({ name: `IT-155-staff-layout-${tag()}`, description: "new" }).select("id").single();
      expect(layout.error).toBeNull();
      layoutIds.push(layout.data!.id as string);
      expect((await c.from("room_layouts").update({ description: "edited", is_active: false }).eq("id", layout.data!.id)).error).toBeNull();
      expect((await admin.from("room_layouts").select("description, is_active").eq("id", layout.data!.id).single()).data).toEqual({
        description: "edited",
        is_active: false,
      });
      expect((await c.from("room_layouts").delete().eq("id", layout.data!.id)).error).toBeNull();
      expect(await exists("room_layouts", layout.data!.id as string)).toBe(false);

      const facility = await c.from("facilities").insert({ name: `IT-155-staff-facility-${tag()}` }).select("id").single();
      expect(facility.error).toBeNull();
      facilityIds.push(facility.data!.id as string);
      expect((await c.from("facilities").update({ description: "edited" }).eq("id", facility.data!.id)).error).toBeNull();
      expect((await admin.from("facilities").select("description").eq("id", facility.data!.id).single()).data).toEqual({ description: "edited" });
      expect((await c.from("facilities").delete().eq("id", facility.data!.id)).error).toBeNull();
      expect(await exists("facilities", facility.data!.id as string)).toBe(false);
    });

    it("155-S4: Venue Staff add, edit and remove a venue's layout and facility links", async () => {
      const c = who.venueStaff.client;

      expect((await c.from("venue_supported_layouts").insert({ venue_id: venue, room_layout_id: spareLayout, max_capacity_for_layout: 60 })).error).toBeNull();
      expect((await c.from("venue_supported_layouts").update({ max_capacity_for_layout: 70 }).eq("venue_id", venue).eq("room_layout_id", spareLayout)).error).toBeNull();
      const edited = await admin.from("venue_supported_layouts").select("max_capacity_for_layout").eq("venue_id", venue).eq("room_layout_id", spareLayout);
      expect(edited.data).toEqual([{ max_capacity_for_layout: 70 }]);
      expect((await c.from("venue_supported_layouts").delete().eq("venue_id", venue).eq("room_layout_id", spareLayout)).error).toBeNull();
      expect((await admin.from("venue_supported_layouts").select("id").eq("venue_id", venue).eq("room_layout_id", spareLayout)).data).toEqual([]);

      expect((await c.from("venue_facilities").insert({ venue_id: venue, facility_id: spareFacility })).error).toBeNull();
      expect((await admin.from("venue_facilities").select("facility_id").eq("venue_id", venue).eq("facility_id", spareFacility)).data).toHaveLength(1);
      expect((await c.from("venue_facilities").delete().eq("venue_id", venue).eq("facility_id", spareFacility)).error).toBeNull();
      expect((await admin.from("venue_facilities").select("facility_id").eq("venue_id", venue).eq("facility_id", spareFacility)).data).toEqual([]);
    });
  });

  describe("SCRUM-155/AC2 venues", () => {
    it("155-S5: Venue Staff add a venue and edit its columns; nobody deletes one", async () => {
      const c = who.venueStaff.client;

      const created = await c.from("venues").insert({ name: `IT-155-staff-venue-${tag()}`, address: "2 Test Road", max_capacity: 40 }).select("id").single();
      expect(created.error).toBeNull();
      const id = created.data!.id as string;
      venueIds.push(id);

      const edit = await c
        .from("venues")
        .update({ name: `IT-155-renamed-${tag()}`, max_capacity: 55, is_accessible: true, accessibility_notes: "Step-free", is_active: false })
        .eq("id", id);
      expect(edit.error).toBeNull();
      expect((await admin.from("venues").select("max_capacity, is_accessible, is_active").eq("id", id).single()).data).toEqual({
        max_capacity: 55,
        is_accessible: true,
        is_active: false,
      });

      for (const key of everyone) {
        const { error } = await who[key].client.from("venues").delete().eq("id", id);
        expect(error?.code, key).toBe(DENIED);
      }
      expect(await exists("venues", id)).toBe(true);
    });
  });

  describe("SCRUM-155/AC4 only Technical Support Staff change equipment", () => {
    it("155-S6: every other role is refused inserting equipment, and updates and deletes change nothing", async () => {
      for (const key of notTechnicalSupport) {
        const c = who[key].client;
        const insert = await c.from("equipment").insert({ name: `IT-155-denied-${key}`, total_quantity: 1 });
        expect(insert.error?.code, key).toBe(DENIED);
        await c.from("equipment").update({ total_quantity: 99, operational_status: "retired" }).eq("id", equipment);
        await c.from("equipment").delete().eq("id", equipment);
      }
      expect((await admin.from("equipment").select("id").like("name", "IT-155-denied-%")).data).toEqual([]);
      expect((await admin.from("equipment").select("total_quantity, operational_status").eq("id", equipment).single()).data).toEqual({
        total_quantity: 5,
        operational_status: "available",
      });
    });

    it("155-S7: Technical Support Staff add and edit equipment, including its status; nobody deletes it", async () => {
      const c = who.technicalSupport.client;

      const created = await c.from("equipment").insert({ name: `IT-155-tech-equipment-${tag()}`, total_quantity: 3, type: "audio" }).select("id").single();
      expect(created.error).toBeNull();
      const id = created.data!.id as string;
      equipmentIds.push(id);

      const edit = await c.from("equipment").update({ total_quantity: 8, operational_status: "under_maintenance" }).eq("id", id);
      expect(edit.error).toBeNull();
      expect((await admin.from("equipment").select("total_quantity, operational_status").eq("id", id).single()).data).toEqual({
        total_quantity: 8,
        operational_status: "under_maintenance",
      });

      for (const key of everyone) {
        const { error } = await who[key].client.from("equipment").delete().eq("id", id);
        expect(error?.code, key).toBe(DENIED);
      }
      expect(await exists("equipment", id)).toBe(true);
    });
  });

  describe("SCRUM-155/AC5 organisations and event categories", () => {
    it("155-S8: no role writes organisations or event categories through the API", async () => {
      for (const key of everyone) {
        const c = who[key].client;
        for (const [table, id] of [["organisations", organisation], ["event_categories", category]] as const) {
          expect((await c.from(table).insert({ name: `IT-155-denied-${key}` })).error?.code, `${key} insert ${table}`).toBe(DENIED);
          expect((await c.from(table).update({ name: `IT-155-changed-${key}` }).eq("id", id)).error?.code, `${key} update ${table}`).toBe(DENIED);
          expect((await c.from(table).delete().eq("id", id)).error?.code, `${key} delete ${table}`).toBe(DENIED);
        }
      }
      for (const [table, id] of [["organisations", organisation], ["event_categories", category]] as const) {
        const row = await admin.from(table).select("name").eq("id", id).single();
        expect(row.data!.name).toMatch(/^IT-155-(org|category)-/);
      }
      expect((await admin.from("organisations").select("id").like("name", "IT-155-denied-%")).data).toEqual([]);
      expect((await admin.from("event_categories").select("id").like("name", "IT-155-denied-%")).data).toEqual([]);
    });
  });

  describe("SCRUM-155/AC6 venue timing and unavailability still work", () => {
    it("155-S9: Venue Staff set a venue's times through set_venue_timing, while writing the columns directly is still refused", async () => {
      const c = who.venueStaff.client;

      const set = await c.rpc("set_venue_timing", { p_venue_id: venue, p_setup: 20, p_turnaround: 25 });
      expect(set.error).toBeNull();
      expect((await admin.from("venues").select("setup_minutes, turnaround_minutes").eq("id", venue).single()).data).toEqual({
        setup_minutes: 20,
        turnaround_minutes: 25,
      });
      expect((await c.from("venues").update({ setup_minutes: 99 }).eq("id", venue)).error?.code).toBe(DENIED);

      const start = new Date(Date.now() + 40 * 24 * 3600 * 1000);
      const end = new Date(start.getTime() + 2 * 3600 * 1000);
      const blockId = await fixtures.unavailabilityAs(c, venue, start, end);
      expect(await exists("venue_unavailability", blockId)).toBe(true);
    });
  });

  describe("SCRUM-155/AC7 a layout in use cannot be deleted", () => {
    it("155-S10: Venue Staff deleting a layout a venue supports is refused and the layout stays", async () => {
      const { error } = await who.venueStaff.client.from("room_layouts").delete().eq("id", linkedLayout);
      expect(error?.code).toBe(IN_USE);
      expect(await exists("room_layouts", linkedLayout)).toBe(true);
    });

    it("155-S10: Venue Staff deleting a layout an event prefers is refused and the layout stays", async () => {
      const preferred = await newLayout();
      const event = await admin
        .from("events")
        .insert({
          name: `IT-155-event-${tag()}`,
          organiser_id: who.organiser.userId,
          status: "submitted",
          is_draft: false,
          expected_attendance: 20,
          preferred_room_layout_id: preferred,
        })
        .select("id")
        .single();
      if (event.error) throw new Error(event.error.message);
      eventIds.push(event.data.id as string);

      const { error } = await who.venueStaff.client.from("room_layouts").delete().eq("id", preferred);
      expect(error?.code).toBe(IN_USE);
      expect(await exists("room_layouts", preferred)).toBe(true);
    });

    it("155-S11: deleting a facility removes it from the venues that had it and leaves the venues", async () => {
      const facility = await newFacility();
      const own = await fixtures.venue("IT-155-facility-venue");
      expect((await admin.from("venue_facilities").insert({ venue_id: own, facility_id: facility })).error).toBeNull();

      expect((await who.venueStaff.client.from("facilities").delete().eq("id", facility)).error).toBeNull();

      expect((await admin.from("venue_facilities").select("facility_id").eq("venue_id", own)).data).toEqual([]);
      expect(await exists("venues", own)).toBe(true);
    });
  });
});
