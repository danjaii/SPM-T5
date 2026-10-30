import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookingsOverCapacity } from "@spm-t5/shared";
import { SupabaseVenueEditReader } from "../../src/readers/venueEditReader";
import { adminClient, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-58 (docs/specs/venue-edit.md): update_venue (migration 64) edits a venue and replaces its layouts and facilities in one
 * step, for Venue Staff only. Every check signs in as a seeded user, so it goes through the same JWT + publishable-key path the
 * services use. Venues are made by the fixtures (named "IT-58-...") and removed afterwards. Assertions only cover those venues,
 * never a count of a whole table (CLAUDE.md, SCRUM-143).
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
const NO_SUCH_VENUE = "P0002";
const UNKNOWN_LAYOUT = "CS571";
const UNKNOWN_FACILITY = "CS572";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const NIL_ID = "00000000-0000-0000-0000-000000000000";

describe.skipIf(!hasDb)("SCRUM-58 Venue Staff edit a venue (migration 64)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  const who = {} as Record<Who, Actor>;
  const everyone = Object.keys(EMAILS) as Who[];
  const notVenueStaff = everyone.filter((r) => r !== "venueStaff");
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

  afterAll(() => fixtures.cleanup());

  /** A venue as the app would have made it: one layout, one facility, and setup and turnaround times already set. */
  const aVenue = async (extra: Record<string, unknown> = {}) => {
    const id = await fixtures.venue("IT-58-venue", { max_capacity: 100, setup_minutes: 30, turnaround_minutes: 45, is_accessible: false, ...extra });
    const links = await Promise.all([
      admin.from("venue_supported_layouts").insert({ venue_id: id, room_layout_id: layoutA, max_capacity_for_layout: 100 }),
      admin.from("venue_facilities").insert({ venue_id: id, facility_id: facilityA }),
    ]);
    for (const l of links) if (l.error) throw new Error(l.error.message);
    return id;
  };

  const update = (actor: Actor, venueId: string, extra: Record<string, unknown> = {}) =>
    actor.client.rpc("update_venue", {
      p_venue_id: venueId,
      p_name: "IT-58-renamed",
      p_address: "9 East Wing",
      p_description: "Now with a stage.",
      p_max_capacity: 200,
      p_hours_start: "09:00",
      p_hours_end: "21:00",
      p_is_accessible: true,
      p_accessibility_notes: "Step-free entrance.",
      p_layouts: [{ layout_id: layoutB, max_capacity: 120 }],
      p_facility_ids: [facilityB],
      ...extra,
    });

  const venueRow = async (id: string) => (await admin.from("venues").select("*").eq("id", id).single()).data as Record<string, unknown>;
  const layoutsOf = async (id: string) => ((await admin.from("venue_supported_layouts").select("room_layout_id, max_capacity_for_layout").eq("venue_id", id)).data ?? []);
  const facilitiesOf = async (id: string) => ((await admin.from("venue_facilities").select("facility_id").eq("venue_id", id)).data ?? []).map((f) => f.facility_id);

  /** Nothing about the venue changed: the old name, capacity, layouts and facilities are all still there. */
  const expectUntouched = async (id: string) => {
    expect(await venueRow(id)).toMatchObject({ max_capacity: 100, is_accessible: false });
    expect((await venueRow(id)).name).toMatch(/^IT-58-venue/);
    expect(await layoutsOf(id)).toEqual([{ room_layout_id: layoutA, max_capacity_for_layout: 100 }]);
    expect(await facilitiesOf(id)).toEqual([facilityA]);
  };

  describe("SCRUM-58/AC1 a venue is edited whole (58-S1)", () => {
    it("58-S1: the venue, its layouts and its facilities are all replaced, and setup, turnaround and active status are left alone", async () => {
      const id = await aVenue();
      const { error } = await update(who.venueStaff, id);
      expect(error).toBeNull();

      expect(await venueRow(id)).toMatchObject({
        name: "IT-58-renamed",
        address: "9 East Wing",
        description: "Now with a stage.",
        max_capacity: 200,
        operating_hours_start: "09:00:00",
        operating_hours_end: "21:00:00",
        is_accessible: true,
        accessibility_notes: "Step-free entrance.",
        setup_minutes: 30,
        turnaround_minutes: 45,
        is_active: true,
      });
      expect(await layoutsOf(id)).toEqual([{ room_layout_id: layoutB, max_capacity_for_layout: 120 }]);
      expect(await facilitiesOf(id)).toEqual([facilityB]);
    });

    it("58-S1: a coordinator reads the edited venue straight away, with its new layouts and facilities", async () => {
      const id = await aVenue();
      await update(who.venueStaff, id);

      const { data } = await who.coordinator.client
        .from("venues")
        .select("name, venue_supported_layouts(max_capacity_for_layout), venue_facilities(facility_id)")
        .eq("id", id)
        .single();
      expect(data).toMatchObject({ name: "IT-58-renamed", venue_supported_layouts: [{ max_capacity_for_layout: 120 }], venue_facilities: [{ facility_id: facilityB }] });
    });

    it("58-S1: hours and facilities can be cleared, and repeated facilities count once", async () => {
      const id = await aVenue();
      expect((await update(who.venueStaff, id, { p_hours_start: null, p_hours_end: null, p_facility_ids: [] })).error).toBeNull();
      expect(await venueRow(id)).toMatchObject({ operating_hours_start: null, operating_hours_end: null });
      expect(await facilitiesOf(id)).toEqual([]);

      expect((await update(who.venueStaff, id, { p_facility_ids: [facilityA, facilityA] })).error).toBeNull();
      expect(await facilitiesOf(id)).toEqual([facilityA]);
    });

    it("58-S1: the edit is logged against the venue, with the capacity when it changed", async () => {
      const id = await aVenue();
      await update(who.venueStaff, id);
      await update(who.venueStaff, id, { p_name: "IT-58-again" });

      const log = await admin.from("activity_log").select("action_type, actor_id, description").eq("entity_id", id).order("created_at");
      expect(log.data).toEqual([
        { action_type: "venue_updated", actor_id: who.venueStaff.userId, description: "Edited venue IT-58-renamed (capacity 100 to 200)" },
        { action_type: "venue_updated", actor_id: who.venueStaff.userId, description: "Edited venue IT-58-again" },
      ]);
    });
  });

  describe("SCRUM-58/AC2 nothing is half-saved (58-S2)", () => {
    it("58-S2: a layout that is not in the catalogue is refused and the venue is unchanged", async () => {
      const id = await aVenue();
      const { error } = await update(who.venueStaff, id, { p_layouts: [{ layout_id: NIL_ID, max_capacity: 10 }] });
      expect(error?.code).toBe(UNKNOWN_LAYOUT);
      await expectUntouched(id);
    });

    it("58-S2: a facility that is not in the catalogue is refused and the venue is unchanged", async () => {
      const id = await aVenue();
      const { error } = await update(who.venueStaff, id, { p_facility_ids: [facilityB, NIL_ID] });
      expect(error?.code).toBe(UNKNOWN_FACILITY);
      await expectUntouched(id);
    });

    it("58-S2: a layout listed twice fails after the old layouts are gone, and the whole edit is rolled back, old layouts included", async () => {
      const id = await aVenue();
      const { error } = await update(who.venueStaff, id, {
        p_layouts: [
          { layout_id: layoutB, max_capacity: 100 },
          { layout_id: layoutB, max_capacity: 90 },
        ],
      });
      expect(error?.code).toBe(UNIQUE_VIOLATION);
      await expectUntouched(id);
    });

    it("58-S2: a capacity of 0 is stopped by the table's own check, and the venue is unchanged", async () => {
      const id = await aVenue();
      const { error } = await update(who.venueStaff, id, { p_max_capacity: 0 });
      expect(error?.code).toBe(CHECK_VIOLATION);
      await expectUntouched(id);
    });
  });

  describe("SCRUM-58/AC3 only venue staff can edit (58-S3)", () => {
    it.each(notVenueStaff)("58-S3: %s is refused by update_venue and the venue is unchanged", async (key) => {
      const id = await aVenue();
      const { error } = await update(who[key], id);
      expect(error?.code).toBe(DENIED);
      await expectUntouched(id);
    });

    it.each(notVenueStaff)("58-S3: %s cannot update the venue directly either", async (key) => {
      const id = await aVenue();
      await who[key].client.from("venues").update({ name: "IT-58-direct", max_capacity: 5 }).eq("id", id);
      await expectUntouched(id);
    });

    it("58-S3: a visitor who is not signed in cannot call update_venue", async () => {
      const id = await aVenue();
      const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
      const { error } = await anon.rpc("update_venue", {
        p_venue_id: id, p_name: "IT-58-visitor", p_address: "A", p_description: null, p_max_capacity: 5, p_hours_start: null,
        p_hours_end: null, p_is_accessible: false, p_accessibility_notes: null, p_layouts: [{ layout_id: layoutA, max_capacity: 5 }], p_facility_ids: [],
      });
      expect(error).not.toBeNull();
      await expectUntouched(id);
    });

    it("58-S3: an unknown venue is P0002, and nothing is made", async () => {
      const { error } = await update(who.venueStaff, NIL_ID);
      expect(error?.code).toBe(NO_SUCH_VENUE);
    });
  });

  describe("SCRUM-58/AC4 the venue and its bookings as the service reads them (58-S4)", () => {
    const FAR = (day: number, from: string, to: string) => ({ start: `2099-03-${String(day).padStart(2, "0")}T${from}:00Z`, end: `2099-03-${String(day).padStart(2, "0")}T${to}:00Z` });

    const book = async (venueId: string, day: number, status: string, attendance: number | null, name: string) => {
      const eventId = await fixtures.event("approved");
      const p = FAR(day, "01:00", "09:00");
      const { error } = await admin.from("venue_bookings").insert({
        event_id: eventId,
        venue_id: venueId,
        requested_by: who.coordinator.userId,
        status,
        event_start_datetime: p.start,
        event_end_datetime: p.end,
        snapshot_event_name: name,
        snapshot_expected_attendance: attendance,
      });
      if (error) throw new Error(error.message);
    };

    it("58-S4: venue staff read the form's values with ids, and only the holding bookings, with their own attendance", async () => {
      const id = await aVenue({ max_capacity: 150 });
      await book(id, 10, "approved", 120, "IT-58 big approved");
      await book(id, 11, "requested", 80, "IT-58 small requested");
      await book(id, 12, "cancelled", 140, "IT-58 cancelled");
      await book(id, 13, "rejected", 140, "IT-58 rejected");
      const reader = new SupabaseVenueEditReader(who.venueStaff.client);

      expect(await reader.forEdit(id)).toMatchObject({
        maxCapacity: 150,
        layouts: [{ layoutId: layoutA, maxCapacity: 100 }],
        facilityIds: [facilityA],
        isAccessible: false,
      });
      expect(await reader.forEdit(NIL_ID)).toBeNull();

      const bookings = await reader.bookings(id);
      expect(bookings.map((b) => [b.eventName, b.status, b.expectedAttendance]).sort()).toEqual([
        ["IT-58 big approved", "approved", 120],
        ["IT-58 small requested", "requested", 80],
      ]);

      // the shared rule, on what the database returned: a cut to 100 leaves only the 120-person booking over capacity
      const over = bookingsOverCapacity(bookings, 100, 150, new Date());
      expect(over.map((b) => b.eventName)).toEqual(["IT-58 big approved"]);
      expect(bookingsOverCapacity(bookings, 150, 150, new Date())).toEqual([]);
    });

    it("58-S4: after a confirmed cut the booking is still held as it was, so nothing is cancelled or flagged", async () => {
      const id = await aVenue({ max_capacity: 150 });
      await book(id, 10, "approved", 120, "IT-58 kept");

      expect((await update(who.venueStaff, id, { p_max_capacity: 100, p_layouts: [{ layout_id: layoutA, max_capacity: 100 }] })).error).toBeNull();

      const kept = await admin.from("venue_bookings").select("id, status, snapshot_expected_attendance").eq("venue_id", id).single();
      expect(kept.data).toMatchObject({ status: "approved", snapshot_expected_attendance: 120 });
      const flags = await admin.from("venue_booking_flags").select("id").eq("booking_id", kept.data!.id);
      expect(flags.data ?? []).toEqual([]);
    });
  });
});
