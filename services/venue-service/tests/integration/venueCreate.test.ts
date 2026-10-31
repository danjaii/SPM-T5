import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-57 (docs/specs/venue-add.md): create_venue (migration 73) adds a venue with its layouts and facilities in one
 * step, for Venue Staff only. Every check signs in as a seeded user, so it goes through the same JWT + publishable-key path
 * the services use. Venues made here are named "IT-57-..." and removed afterwards. Assertions only cover those venues, never
 * a count of a whole table (CLAUDE.md, SCRUM-143).
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
const UNKNOWN_LAYOUT = "CS571";
const UNKNOWN_FACILITY = "CS572";
const UNIQUE_VIOLATION = "23505";
const NOT_A_UUID = "22P02";

const tag = () => Math.random().toString(36).slice(2, 8);
const NIL_ID = "00000000-0000-0000-0000-000000000000";

describe.skipIf(!hasDb)("SCRUM-57 Venue Staff add a venue (migration 73)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<Who, Actor>;
  const everyone = Object.keys(EMAILS) as Who[];
  const notVenueStaff = everyone.filter((r) => r !== "venueStaff");
  const prefix = `IT-57-${tag()}`;
  let layoutA: string;
  let layoutB: string;
  let facilityA: string;
  let facilityB: string;

  beforeAll(async () => {
    for (const key of everyone) who[key] = await signInAs(EMAILS[key]);
    const layouts = await admin.from("room_layouts").select("id").limit(2);
    const facilities = await admin.from("facilities").select("id").limit(2);
    if ((layouts.data ?? []).length < 2 || (facilities.data ?? []).length < 2) throw new Error("Need two seeded layouts and facilities (run supabase db reset)");
    [layoutA, layoutB] = layouts.data!.map((l) => l.id as string);
    [facilityA, facilityB] = facilities.data!.map((f) => f.id as string);
  });

  afterAll(async () => {
    const { data } = await admin.from("venues").select("id").like("name", `${prefix}%`);
    const ids = (data ?? []).map((v) => v.id as string);
    if (ids.length) {
      await admin.from("activity_log").delete().in("entity_id", ids);
      await admin.from("venues").delete().in("id", ids); // layouts and facilities go with the venue (on delete cascade)
    }
  });

  const create = (actor: Actor, name: string, extra: Record<string, unknown> = {}) =>
    actor.client.rpc("create_venue", {
      p_name: name,
      p_address: "1 Test Road",
      p_description: null,
      p_max_capacity: 120,
      p_hours_start: "08:00",
      p_hours_end: "22:00",
      p_is_accessible: true,
      p_accessibility_notes: "Step-free entrance.",
      p_layouts: [{ layout_id: layoutA, max_capacity: 120 }],
      p_facility_ids: [facilityA],
      ...extra,
    });

  const venuesNamed = async (name: string) => {
    const { data, error } = await admin.from("venues").select("id").eq("name", name);
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  describe("SCRUM-57/AC1 a venue is added whole (57-S1)", () => {
    it("57-S1: venue staff get the new id, and the venue, its layouts and its facilities are all there", async () => {
      const name = `${prefix}-whole`;
      const { data: id, error } = await create(who.venueStaff, name, {
        p_layouts: [
          { layout_id: layoutA, max_capacity: 120 },
          { layout_id: layoutB, max_capacity: 80 },
        ],
        p_facility_ids: [facilityA, facilityB],
      });
      expect(error).toBeNull();

      const venue = await admin
        .from("venues")
        .select("name, address, max_capacity, operating_hours_start, operating_hours_end, is_accessible, accessibility_notes, setup_minutes, turnaround_minutes, is_active")
        .eq("id", id)
        .single();
      expect(venue.data).toEqual({
        name,
        address: "1 Test Road",
        max_capacity: 120,
        operating_hours_start: "08:00:00",
        operating_hours_end: "22:00:00",
        is_accessible: true,
        accessibility_notes: "Step-free entrance.",
        setup_minutes: 0,
        turnaround_minutes: 0,
        is_active: true,
      });
      const layouts = await admin.from("venue_supported_layouts").select("room_layout_id, max_capacity_for_layout").eq("venue_id", id);
      expect((layouts.data ?? []).sort((a, b) => b.max_capacity_for_layout - a.max_capacity_for_layout)).toEqual([
        { room_layout_id: layoutA, max_capacity_for_layout: 120 },
        { room_layout_id: layoutB, max_capacity_for_layout: 80 },
      ]);
      const facilities = await admin.from("venue_facilities").select("facility_id").eq("venue_id", id);
      expect((facilities.data ?? []).map((f) => f.facility_id).sort()).toEqual([facilityA, facilityB].sort());
    });

    it("57-S1: a coordinator can read the new venue straight away, with its layouts and facilities", async () => {
      const name = `${prefix}-visible`;
      const { data: id } = await create(who.venueStaff, name);

      const { data } = await who.coordinator.client
        .from("venues")
        .select("name, venue_supported_layouts(max_capacity_for_layout), venue_facilities(facility_id)")
        .eq("id", id)
        .single();
      expect(data).toMatchObject({ name, venue_supported_layouts: [{ max_capacity_for_layout: 120 }], venue_facilities: [{ facility_id: facilityA }] });
    });

    it("57-S1: a venue with no operating hours, no description and no facilities is fine, and repeated facilities count once", async () => {
      const { data: id, error } = await create(who.venueStaff, `${prefix}-bare`, {
        p_hours_start: null,
        p_hours_end: null,
        p_is_accessible: false,
        p_accessibility_notes: null,
        p_facility_ids: [facilityA, facilityA],
      });
      expect(error).toBeNull();
      const venue = await admin.from("venues").select("operating_hours_start, is_accessible").eq("id", id).single();
      expect(venue.data).toEqual({ operating_hours_start: null, is_accessible: false });
      const facilities = await admin.from("venue_facilities").select("facility_id").eq("venue_id", id);
      expect(facilities.data).toEqual([{ facility_id: facilityA }]);
    });

    it("57-S1: two venues may share a name", async () => {
      const name = `${prefix}-twin`;
      const first = await create(who.venueStaff, name);
      const second = await create(who.venueStaff, name, { p_address: "9 East Wing" });
      expect([first.error, second.error]).toEqual([null, null]);
      expect(first.data).not.toBe(second.data);
      expect(await venuesNamed(name)).toHaveLength(2);
    });

    it("57-S1: the addition is logged against the new venue", async () => {
      const { data: id } = await create(who.venueStaff, `${prefix}-logged`);
      const log = await admin.from("activity_log").select("action_type, actor_id").eq("entity_id", id).single();
      expect(log.data).toEqual({ action_type: "venue_created", actor_id: who.venueStaff.userId });
    });
  });

  describe("SCRUM-57/AC2 nothing half-made is left behind (57-S2)", () => {
    it("57-S2: a layout that is not in the catalogue is refused and no venue is made", async () => {
      const name = `${prefix}-badlayout`;
      const { error } = await create(who.venueStaff, name, { p_layouts: [{ layout_id: NIL_ID, max_capacity: 10 }] });
      expect(error?.code).toBe(UNKNOWN_LAYOUT);
      expect(await venuesNamed(name)).toHaveLength(0);
    });

    it("57-S2: a facility that is not in the catalogue is refused and no venue is made", async () => {
      const name = `${prefix}-badfacility`;
      const { error } = await create(who.venueStaff, name, { p_facility_ids: [facilityA, NIL_ID] });
      expect(error?.code).toBe(UNKNOWN_FACILITY);
      expect(await venuesNamed(name)).toHaveLength(0);
    });

    it("57-S2: a layout listed twice fails after the venue row is in, and the whole save is rolled back", async () => {
      const name = `${prefix}-twice`;
      const { error } = await create(who.venueStaff, name, {
        p_layouts: [
          { layout_id: layoutA, max_capacity: 100 },
          { layout_id: layoutA, max_capacity: 90 },
        ],
      });
      expect(error?.code).toBe(UNIQUE_VIOLATION);
      expect(await venuesNamed(name)).toHaveLength(0);
    });

    it("57-S2: a capacity of 0 is stopped by the table's own check, and nothing is left behind", async () => {
      const name = `${prefix}-zero`;
      const { error } = await create(who.venueStaff, name, { p_max_capacity: 0 });
      expect(error).not.toBeNull();
      expect(await venuesNamed(name)).toHaveLength(0);
    });

    it("57-S2: an id that is not an id is refused", async () => {
      const name = `${prefix}-notid`;
      const { error } = await create(who.venueStaff, name, { p_layouts: [{ layout_id: "not-an-id", max_capacity: 10 }] });
      expect(error?.code).toBe(NOT_A_UUID);
      expect(await venuesNamed(name)).toHaveLength(0);
    });
  });

  describe("SCRUM-57/AC3 only venue staff can add (57-S3)", () => {
    it.each(notVenueStaff)("57-S3: %s is refused by create_venue and no venue is made", async (key) => {
      const name = `${prefix}-no-${key}`;
      const { error } = await create(who[key], name);
      expect(error?.code).toBe(DENIED);
      expect(await venuesNamed(name)).toHaveLength(0);
    });

    it.each(notVenueStaff)("57-S3: %s cannot insert a venue directly either", async (key) => {
      const name = `${prefix}-direct-${key}`;
      const { error } = await who[key].client.from("venues").insert({ name, address: "1 Test Road", max_capacity: 10 });
      expect(error?.code).toBe(DENIED);
      expect(await venuesNamed(name)).toHaveLength(0);
    });

    it("57-S3: a visitor who is not signed in cannot call create_venue", async () => {
      const { createClient } = await import("@supabase/supabase-js");
      const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
      const name = `${prefix}-visitor`;
      const { error } = await anon.rpc("create_venue", {
        p_name: name,
        p_address: "1 Test Road",
        p_description: null,
        p_max_capacity: 10,
        p_hours_start: null,
        p_hours_end: null,
        p_is_accessible: false,
        p_accessibility_notes: null,
        p_layouts: [{ layout_id: layoutA, max_capacity: 10 }],
        p_facility_ids: [],
      });
      expect(error).not.toBeNull();
      expect(await venuesNamed(name)).toHaveLength(0);
    });
  });
});
