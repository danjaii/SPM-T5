import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calendarRange, sgtToUtc } from "@spm-t5/shared";
import { SupabaseVenueCalendarReader } from "../../src/readers/venueCalendarReader";
import { buildCalendar } from "../../src/services/venueCalendarService";
import { adminClient, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-84: the venue availability calendar against Postgres (migration 58, venue_calendar_entries). Users sign in as seeded
 * accounts, so the role check inside the function and RLS are exercised for real. Fixtures are throwaway ("IT-"), dated 2031, and
 * every assertion is scoped to the test's own venue, so other data in the database cannot change a result.
 */
const EMAILS = {
  coordinator: "rachel.tan@connectsphere.example.com",
  otherCoordinator: "marcus.lim@connectsphere.example.com",
  venueStaff: "kenneth.wong@connectsphere.example.com",
  technicalSupport: "aaron.koh@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
  attendee: "alicia.fernandez@example.com",
};
const DENIED = "42501";
const DAY = "2031-03-14";
const at = (time: string, date = DAY) => sgtToUtc(date, time);
const RANGE = calendarRange(DAY, DAY);

type Actor = { client: SupabaseClient; userId: string };

describe.skipIf(!hasDb)("SCRUM-84 venue availability calendar (migration 58)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  const who = {} as Record<keyof typeof EMAILS, Actor>;

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as (keyof typeof EMAILS)[]) who[key] = await signInAs(EMAILS[key]);
  });
  afterAll(async () => {
    await fixtures.cleanup();
  });

  /** A holding booking arranged with the secret key. `side` is the coordinator whose event it is. */
  async function hold(venueId: string, start: Date, end: Date, status = "requested", side: "coordinator" | "otherCoordinator" = "otherCoordinator") {
    const eventId = await fixtures.event("approved", who[side].userId);
    const { data, error } = await admin
      .from("venue_bookings")
      .insert({ event_id: eventId, venue_id: venueId, requested_by: who[side].userId, status, event_start_datetime: start.toISOString(), event_end_datetime: end.toISOString() })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }

  /** The calendar as the app builds it, for one signed-in user, narrowed to the venue the test made. */
  async function calendarFor(actor: Actor, venueId: string) {
    const reader = new SupabaseVenueCalendarReader(actor.client);
    const [venues, entries] = await Promise.all([reader.venueList(), reader.entries(RANGE.start, RANGE.end)]);
    return buildCalendar(venues, entries, RANGE).find((v) => v.id === venueId);
  }

  it("SCRUM-84/AC1: coordinator, venue staff and technical support each see the new venue, with nothing on it Available all day", async () => {
    const venue = await fixtures.venue("IT-cal-open");
    for (const key of ["coordinator", "venueStaff", "technicalSupport"] as const) {
      const view = await calendarFor(who[key], venue);
      expect(view?.periods).toEqual([{ kind: "open", status: "AVAILABLE", label: "Available", start: RANGE.start.toISOString(), end: RANGE.end.toISOString() }]);
    }
  });

  it("SCRUM-84/AC1: an inactive venue is not listed", async () => {
    const venue = await fixtures.venue("IT-cal-inactive", { is_active: false });
    expect(await calendarFor(who.coordinator, venue)).toBeUndefined();
  });

  it("SCRUM-84/AC2: a Pending request is Tentatively Held and an Approved one Confirmed, with setup and turnaround, seen by every allowed role even when another coordinator owns it", async () => {
    const venue = await fixtures.venue("IT-cal-status", { setup_minutes: 30, turnaround_minutes: 45 });
    await hold(venue, at("10:00"), at("12:00"), "requested");
    await hold(venue, at("14:00"), at("15:00"), "approved");

    for (const key of ["coordinator", "venueStaff", "technicalSupport"] as const) {
      const view = await calendarFor(who[key], venue);
      expect(view?.periods.filter((p) => p.kind === "event").map((p) => [p.status, p.label, p.start, p.end])).toEqual([
        ["TENTATIVELY_HELD", "Tentatively Held", at("10:00").toISOString(), at("12:00").toISOString()],
        ["CONFIRMED", "Confirmed", at("14:00").toISOString(), at("15:00").toISOString()],
      ]);
      expect(view?.periods.find((p) => p.kind === "setup")).toMatchObject({ start: at("09:30").toISOString(), end: at("10:00").toISOString() });
      expect(view?.periods.find((p) => p.kind === "turnaround")).toMatchObject({ start: at("12:00").toISOString(), end: at("12:45").toISOString() });
    }
  });

  it("SCRUM-84/AC2: rejected, withdrawn and cancelled requests do not appear", async () => {
    const venue = await fixtures.venue("IT-cal-closed");
    await hold(venue, at("10:00"), at("11:00"), "rejected");
    await hold(venue, at("12:00"), at("13:00"), "withdrawn");
    await hold(venue, at("14:00"), at("15:00"), "cancelled");

    const view = await calendarFor(who.coordinator, venue);

    expect(view?.periods.map((p) => p.status)).toEqual(["AVAILABLE"]);
  });

  it("SCRUM-84/AC2: a block made by venue staff is Blocked with its reason label, and Technical Support Staff can see it", async () => {
    const venue = await fixtures.venue("IT-cal-block");
    await fixtures.unavailabilityAs(who.venueStaff.client, venue, at("08:00"), at("16:00"), "renovation", "a private note");

    for (const key of ["coordinator", "technicalSupport"] as const) {
      const view = await calendarFor(who[key], venue);
      const block = view?.periods.find((p) => p.kind === "block");
      expect(block).toEqual({ kind: "block", status: "BLOCKED", label: "Blocked", start: at("08:00").toISOString(), end: at("16:00").toISOString(), reason: "renovation", reason_label: "Renovation" });
      expect(JSON.stringify(view)).not.toContain("a private note");
    }
  });

  it("SCRUM-84/AC2: the function returns no notes, no author and no event, coordinator or request", async () => {
    const venue = await fixtures.venue("IT-cal-private");
    await fixtures.unavailabilityAs(who.venueStaff.client, venue, at("08:00"), at("16:00"), "other", "a private note");
    await hold(venue, at("17:00"), at("18:00"));

    const { data, error } = await who.technicalSupport.client.rpc("venue_calendar_entries", { p_from: RANGE.start.toISOString(), p_to: RANGE.end.toISOString() });

    expect(error).toBeNull();
    const mine = (data as Record<string, unknown>[]).filter((r) => r.venue_id === venue);
    expect(mine).toHaveLength(2);
    expect(Object.keys(mine[0]!).sort()).toEqual(["entry", "ends_at", "occupied_end", "occupied_start", "reason", "setup_minutes", "starts_at", "status", "turnaround_minutes", "venue_id"].sort());
  });

  it("SCRUM-84/AC3, AC4: free time inside operating hours is Available and outside is Unavailable", async () => {
    const venue = await fixtures.venue("IT-cal-hours", { operating_hours_start: "08:00", operating_hours_end: "22:00" });

    const view = await calendarFor(who.coordinator, venue);

    expect(view?.operating_hours).toEqual({ start: "08:00", end: "22:00" });
    expect(view?.periods.map((p) => [p.status, p.label, p.start, p.end])).toEqual([
      ["UNAVAILABLE", "Unavailable", RANGE.start.toISOString(), at("08:00").toISOString()],
      ["AVAILABLE", "Available", at("08:00").toISOString(), at("22:00").toISOString()],
      ["UNAVAILABLE", "Unavailable", at("22:00").toISOString(), RANGE.end.toISOString()],
    ]);
  });

  it("SCRUM-84/AC5: a range of several days shows exactly those days", async () => {
    const venue = await fixtures.venue("IT-cal-range");
    const range = calendarRange("2031-03-14", "2031-03-16");
    const reader = new SupabaseVenueCalendarReader(who.coordinator.client);
    const view = buildCalendar(await reader.venueList(), await reader.entries(range.start, range.end), range).find((v) => v.id === venue);
    expect(view?.periods).toEqual([{ kind: "open", status: "AVAILABLE", label: "Available", start: sgtToUtc("2031-03-14", "00:00").toISOString(), end: sgtToUtc("2031-03-17", "00:00").toISOString() }]);
  });

  it("SCRUM-84/AC7: a hold, an approval and a block recorded after the first read show in the next", async () => {
    const venue = await fixtures.venue("IT-cal-fresh");
    expect((await calendarFor(who.coordinator, venue))?.periods.map((p) => p.status)).toEqual(["AVAILABLE"]);

    const booking = await hold(venue, at("10:00"), at("12:00"), "requested");
    expect((await calendarFor(who.coordinator, venue))?.periods.map((p) => p.status)).toEqual(["AVAILABLE", "TENTATIVELY_HELD", "AVAILABLE"]);

    await admin.from("venue_bookings").update({ status: "approved" }).eq("id", booking);
    expect((await calendarFor(who.coordinator, venue))?.periods.map((p) => p.status)).toEqual(["AVAILABLE", "CONFIRMED", "AVAILABLE"]);

    await fixtures.unavailabilityAs(who.venueStaff.client, venue, at("13:00"), at("14:00"));
    expect((await calendarFor(who.coordinator, venue))?.periods.map((p) => p.status)).toEqual(["AVAILABLE", "CONFIRMED", "AVAILABLE", "BLOCKED", "AVAILABLE"]);
  });

  it.each(["organiser", "attendee"] as const)("SCRUM-84/AC8: %s is refused by the database function (42501) and gets no rows", async (key) => {
    const { data, error } = await who[key].client.rpc("venue_calendar_entries", { p_from: RANGE.start.toISOString(), p_to: RANGE.end.toISOString() });
    expect(error?.code).toBe(DENIED);
    expect(data).toBeNull();
  });
});
