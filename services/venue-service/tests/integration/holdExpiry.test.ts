import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sgtToUtc } from "@spm-t5/shared";
import { adminClient, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-97: tentative hold expiry against Postgres (migration 65). A hold is a PENDING ("requested") booking with hold_expires_at
 * set. Venue Staff and coordinators sign in as seeded users, so RLS and the security definer functions behave as in the app.
 * Fixtures are throwaway ("IT-") and dated 2030. Times are relative to now, so no test moves the database clock.
 */
const EMAILS = {
  coordinatorA: "rachel.tan@connectsphere.example.com",
  coordinatorB: "marcus.lim@connectsphere.example.com",
  venueStaff: "kenneth.wong@connectsphere.example.com",
};
const DENIED = "42501";
const HOUR = 3_600_000;
const inHours = (h: number) => new Date(Date.now() + h * HOUR);
const DAY = "2030-11-14";
const slot = (start: string, end: string) => ({ start: sgtToUtc(DAY, start), end: sgtToUtc(DAY, end) });

type Actor = { client: SupabaseClient; userId: string };

describe.skipIf(!hasDb)("SCRUM-97 tentative hold expiry (migration 65)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  const who = {} as Record<keyof typeof EMAILS, Actor>;

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as (keyof typeof EMAILS)[]) who[key] = await signInAs(EMAILS[key]);
  });
  afterAll(async () => {
    await fixtures.cleanup();
  });

  /** A PENDING request ("hold") for coordinator A's event, arranged with the secret key. */
  async function hold(venueId: string, p: { start: Date; end: Date }, extra: Record<string, unknown> = {}) {
    const eventId = await fixtures.event("approved", who.coordinatorA.userId);
    const { data, error } = await admin
      .from("venue_bookings")
      .insert({
        event_id: eventId,
        venue_id: venueId,
        requested_by: who.coordinatorA.userId,
        status: "requested",
        event_start_datetime: p.start.toISOString(),
        event_end_datetime: p.end.toISOString(),
        ...extra,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id as string, eventId };
  }
  const expiryOf = async (id: string) =>
    ((await admin.from("venue_bookings").select("hold_expires_at").eq("id", id).single()).data as { hold_expires_at: string | null }).hold_expires_at;
  const setExpiry = (actor: Actor, id: string, at: Date | null) =>
    actor.client.rpc("set_hold_expiry", { p_booking_id: id, p_expires_at: at ? at.toISOString() : null });

  describe("SCRUM-97/AC1 Venue Staff set a future expiry on a hold", () => {
    it("starts with no expiry and no default", async () => {
      const venue = await fixtures.venue("IT-hold");
      const h = await hold(venue, slot("10:00", "12:00"));
      expect(await expiryOf(h.id)).toBeNull();
    });

    it("lets Venue Staff set it and saves it against that hold", async () => {
      const venue = await fixtures.venue("IT-hold");
      const h = await hold(venue, slot("10:00", "12:00"));
      const at = inHours(48);
      const { error } = await setExpiry(who.venueStaff, h.id, at);
      expect(error).toBeNull();
      expect(new Date((await expiryOf(h.id))!).getTime()).toBe(at.getTime());
    });

    it("refuses a missing expiry, saving nothing (HE001)", async () => {
      const venue = await fixtures.venue("IT-hold");
      const h = await hold(venue, slot("10:00", "12:00"));
      const { error } = await setExpiry(who.venueStaff, h.id, null);
      expect(error?.code).toBe("HE001");
      expect(await expiryOf(h.id)).toBeNull();
    });

    it("refuses an expiry in the past (HE001), keeping the previous one", async () => {
      const venue = await fixtures.venue("IT-hold");
      const first = inHours(24);
      const h = await hold(venue, slot("10:00", "12:00"), { hold_expires_at: first.toISOString() });
      const { error } = await setExpiry(who.venueStaff, h.id, inHours(-1));
      expect(error?.code).toBe("HE001");
      expect(new Date((await expiryOf(h.id))!).getTime()).toBe(first.getTime());
    });

    it("refuses an expiry after the event starts (HE001)", async () => {
      const venue = await fixtures.venue("IT-hold");
      const h = await hold(venue, slot("10:00", "12:00"));
      const { error } = await setExpiry(who.venueStaff, h.id, new Date(sgtToUtc(DAY, "10:00").getTime() + HOUR));
      expect(error?.code).toBe("HE001");
    });

    it("refuses anyone but Venue Staff (42501)", async () => {
      const venue = await fixtures.venue("IT-hold");
      const h = await hold(venue, slot("10:00", "12:00"));
      for (const actor of [who.coordinatorA, who.coordinatorB]) {
        const { error } = await setExpiry(actor, h.id, inHours(24));
        expect(error?.code).toBe(DENIED);
      }
      expect(await expiryOf(h.id)).toBeNull();
    });

    it("refuses a request that is not pending (HE002)", async () => {
      const venue = await fixtures.venue("IT-hold");
      const h = await hold(venue, slot("10:00", "12:00"), { status: "approved" });
      const { error } = await setExpiry(who.venueStaff, h.id, inHours(24));
      expect(error?.code).toBe("HE002");
    });

    it("cannot be called by a caller who is not signed in", async () => {
      const venue = await fixtures.venue("IT-hold");
      const h = await hold(venue, slot("10:00", "12:00"));
      const { createClient } = await import("@supabase/supabase-js");
      const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
      const { error } = await anon.rpc("set_hold_expiry", { p_booking_id: h.id, p_expires_at: inHours(24).toISOString() });
      expect(error?.code).toBe(DENIED);
    });
  });

  /** Whether coordinator B (not the holder) is told the slot is taken, and what a second request for it meets. */
  const slotHeld = async (venue: string, p: { start: Date; end: Date }) =>
    (await who.coordinatorB.client.rpc("venue_slot_is_held", { p_venue_id: venue, p_start: p.start.toISOString(), p_end: p.end.toISOString() })).data as boolean;
  const secondRequest = async (venue: string, p: { start: Date; end: Date }) => {
    const eventId = await fixtures.event("approved", who.coordinatorB.userId);
    return admin.from("venue_bookings").insert({
      event_id: eventId, venue_id: venue, requested_by: who.coordinatorB.userId, status: "requested",
      event_start_datetime: p.start.toISOString(), event_end_datetime: p.end.toISOString(),
    }).select("id").single();
  };

  describe("SCRUM-97/AC2 a live hold blocks its slot", () => {
    it("tells another coordinator the slot is taken and refuses their request, until the expiry", async () => {
      const venue = await fixtures.venue("IT-hold-live");
      await hold(venue, slot("10:00", "12:00"), { hold_expires_at: inHours(2).toISOString() });
      expect(await slotHeld(venue, slot("10:00", "12:00"))).toBe(true);
      const { error } = await secondRequest(venue, slot("10:00", "12:00"));
      expect(error?.code).toBe("23P01"); // the overlap guard, not some other failure
    });

    it("keeps a hold that has no expiry blocking, exactly as before (D4)", async () => {
      const venue = await fixtures.venue("IT-hold-none");
      await hold(venue, slot("10:00", "12:00"));
      expect(await slotHeld(venue, slot("10:00", "12:00"))).toBe(true);
      expect((await secondRequest(venue, slot("10:00", "12:00"))).error).not.toBeNull();
    });
  });

  describe("SCRUM-97/AC3 an expired hold frees the slot", () => {
    it("no longer blocks, and the next coordinator's request is created as a new pending request", async () => {
      const venue = await fixtures.venue("IT-hold-expired");
      const first = await hold(venue, slot("10:00", "12:00"), { hold_expires_at: inHours(-1).toISOString() });
      expect(await slotHeld(venue, slot("10:00", "12:00"))).toBe(false);
      const second = await secondRequest(venue, slot("10:00", "12:00"));
      expect(second.error).toBeNull();
      expect(second.data!.id).not.toBe(first.id);
    });

    it("also frees the padded setup and turnaround time around it", async () => {
      const venue = await fixtures.venue("IT-hold-expired-pad");
      await admin.from("venues").update({ setup_minutes: 30, turnaround_minutes: 45 }).eq("id", venue);
      await hold(venue, slot("10:00", "12:00"), { hold_expires_at: inHours(-1).toISOString() });
      expect(await slotHeld(venue, slot("12:30", "14:00"))).toBe(false);
    });
  });

  describe("SCRUM-97/AC5 an expired hold cannot be confirmed", () => {
    it("refuses approving it (CS097) and leaves it pending, even with the secret key", async () => {
      const venue = await fixtures.venue("IT-hold-confirm");
      const h = await hold(venue, slot("10:00", "12:00"), { hold_expires_at: inHours(-1).toISOString() });
      const { error } = await admin.from("venue_bookings").update({ status: "approved" }).eq("id", h.id);
      expect(error?.code).toBe("CS097");
      expect(((await admin.from("venue_bookings").select("status").eq("id", h.id).single()).data as { status: string }).status).toBe("requested");
    });

    it("still lets a live hold be approved", async () => {
      const venue = await fixtures.venue("IT-hold-confirm-live");
      const h = await hold(venue, slot("10:00", "12:00"), { hold_expires_at: inHours(2).toISOString() });
      const { error } = await admin.from("venue_bookings").update({ status: "approved" }).eq("id", h.id);
      expect(error).toBeNull();
    });
  });

  describe("SCRUM-97/AC6 confirming before the expiry ends the countdown", () => {
    it("keeps an approved booking holding its slot after the old expiry has passed", async () => {
      const venue = await fixtures.venue("IT-hold-approved");
      await hold(venue, slot("10:00", "12:00"), { status: "approved", hold_expires_at: inHours(-1).toISOString() });
      expect(await slotHeld(venue, slot("10:00", "12:00"))).toBe(true);
      expect((await secondRequest(venue, slot("10:00", "12:00"))).error).not.toBeNull();
    });
  });

  describe("SCRUM-97/AC7 Venue Staff extend or shorten a live hold; an expired one cannot be extended", () => {
    it("lets Venue Staff move a live expiry later and earlier", async () => {
      const venue = await fixtures.venue("IT-hold-extend");
      const h = await hold(venue, slot("10:00", "12:00"), { hold_expires_at: inHours(10).toISOString() });
      const later = inHours(30);
      expect((await setExpiry(who.venueStaff, h.id, later)).error).toBeNull();
      expect(new Date((await expiryOf(h.id))!).getTime()).toBe(later.getTime());
      const earlier = inHours(5);
      expect((await setExpiry(who.venueStaff, h.id, earlier)).error).toBeNull();
      expect(new Date((await expiryOf(h.id))!).getTime()).toBe(earlier.getTime());
    });

    it("refuses extending a hold that has already expired (HE003) and keeps its old expiry", async () => {
      const venue = await fixtures.venue("IT-hold-extend-expired");
      const old = inHours(-2);
      const h = await hold(venue, slot("10:00", "12:00"), { hold_expires_at: old.toISOString() });
      const { error } = await setExpiry(who.venueStaff, h.id, inHours(24));
      expect(error?.code).toBe("HE003");
      expect(new Date((await expiryOf(h.id))!).getTime()).toBe(old.getTime());
    });
  });

  describe("SCRUM-97 the venue calendar shows an expired hold as Available", () => {
    const entriesFor = async (venue: string) => {
      const { data, error } = await who.venueStaff.client.rpc("venue_calendar_entries", {
        p_from: sgtToUtc(DAY, "00:00").toISOString(), p_to: new Date(sgtToUtc(DAY, "00:00").getTime() + 24 * HOUR).toISOString(),
      });
      expect(error).toBeNull();
      return (data as { venue_id: string; entry: string; status: string }[]).filter((e) => e.venue_id === venue);
    };

    it("lists a live hold as a booking entry and an expired hold as none", async () => {
      const live = await fixtures.venue("IT-cal-live");
      const dead = await fixtures.venue("IT-cal-expired");
      await hold(live, slot("10:00", "12:00"), { hold_expires_at: inHours(2).toISOString() });
      await hold(dead, slot("10:00", "12:00"), { hold_expires_at: inHours(-1).toISOString() });
      expect((await entriesFor(live)).filter((e) => e.entry !== "block")).toHaveLength(1);
      expect((await entriesFor(dead)).filter((e) => e.entry !== "block")).toHaveLength(0);
    });
  });

  describe("SCRUM-97/AC7 the event's coordinator is told when Venue Staff change the expiry", () => {
    const notesFor = async (actor: Actor, bookingId: string) =>
      ((await actor.client.from("notifications").select("type, title, message, event_id").eq("venue_booking_id", bookingId).eq("type", "hold_expiry_changed")).data ?? []) as { type: string; title: string; message: string; event_id: string }[];

    it("notifies only that coordinator, naming the event, the venue and the new expiry", async () => {
      const venue = await fixtures.venue("IT-hold-notify");
      const h = await hold(venue, slot("10:00", "12:00"), { hold_expires_at: inHours(10).toISOString() });
      expect((await setExpiry(who.venueStaff, h.id, inHours(30))).error).toBeNull();
      const mine = await notesFor(who.coordinatorA, h.id);
      expect(mine).toHaveLength(1);
      expect(mine[0].title).toBe("Hold expiry changed");
      expect(mine[0].message).toMatch(/IT-hold-notify/);
      expect(mine[0].event_id).toBe(h.eventId);
      expect(await notesFor(who.coordinatorB, h.id)).toEqual([]);
    });

    it("notifies again for a second change, and not at all when the save is refused", async () => {
      const venue = await fixtures.venue("IT-hold-notify2");
      const h = await hold(venue, slot("10:00", "12:00"), { hold_expires_at: inHours(10).toISOString() });
      await setExpiry(who.venueStaff, h.id, inHours(20));
      await setExpiry(who.venueStaff, h.id, inHours(5));
      await setExpiry(who.venueStaff, h.id, inHours(-3)); // refused (HE001)
      expect(await notesFor(who.coordinatorA, h.id)).toHaveLength(2);
    });

    it("notifies nobody when the event has no coordinator", async () => {
      const venue = await fixtures.venue("IT-hold-notify3");
      const h = await hold(venue, slot("10:00", "12:00"), { hold_expires_at: inHours(10).toISOString() });
      await admin.from("events").update({ assigned_coordinator_id: null }).eq("id", h.eventId);
      expect((await setExpiry(who.venueStaff, h.id, inHours(20))).error).toBeNull();
      const { data } = await admin.from("notifications").select("id").eq("venue_booking_id", h.id).eq("type", "hold_expiry_changed");
      expect(data).toEqual([]);
    });
  });

  describe("SCRUM-97 review gaps", () => {
    it("AC6 a hold confirmed while live stays confirmed and keeps its slot after its old expiry has passed", async () => {
      const venue = await fixtures.venue("IT-hold-age");
      const h = await hold(venue, slot("10:00", "12:00"), { hold_expires_at: inHours(2).toISOString() });
      expect((await admin.from("venue_bookings").update({ status: "approved" }).eq("id", h.id)).error).toBeNull();
      await admin.from("venue_bookings").update({ hold_expires_at: inHours(-1).toISOString() }).eq("id", h.id); // time passes
      expect(((await admin.from("venue_bookings").select("status").eq("id", h.id).single()).data as { status: string }).status).toBe("approved");
      expect(await slotHeld(venue, slot("10:00", "12:00"))).toBe(true);
      expect((await secondRequest(venue, slot("10:00", "12:00"))).error?.code).toBe("23P01");
    });

    it("the rule changes exactly at the expiry moment (SQL boundary)", async () => {
      const t = "2030-06-01T09:00:00Z";
      const at = (p: string) => admin.rpc("venue_booking_holds_slot", { p_status: "requested", p_hold_expires_at: t, p_at: p }).then((r) => r.data);
      expect(await at("2030-06-01T08:59:59.999Z")).toBe(true);
      expect(await at("2030-06-01T09:00:00Z")).toBe(false);
      expect(await at("2030-06-01T09:00:00.001Z")).toBe(false);
      const approved = await admin.rpc("venue_booking_holds_slot", { p_status: "approved", p_hold_expires_at: t, p_at: "2031-01-01T00:00:00Z" });
      expect(approved.data).toBe(true);
      const none = await admin.rpc("venue_booking_holds_slot", { p_status: "requested", p_hold_expires_at: null, p_at: "2031-01-01T00:00:00Z" });
      expect(none.data).toBe(true);
    });

    it("an expired hold can still be rejected or withdrawn (only confirming is blocked)", async () => {
      const venue = await fixtures.venue("IT-hold-reject");
      const h = await hold(venue, slot("10:00", "12:00"), { hold_expires_at: inHours(-1).toISOString() });
      expect((await admin.from("venue_bookings").update({ status: "rejected" }).eq("id", h.id)).error).toBeNull();
    });

    it("the expiry notification names the event and the new expiry time", async () => {
      const venue = await fixtures.venue("IT-hold-msg");
      const h = await hold(venue, slot("10:00", "12:00"), { hold_expires_at: inHours(10).toISOString() });
      const at = inHours(30);
      await setExpiry(who.venueStaff, h.id, at);
      const { data } = await who.coordinatorA.client.from("notifications").select("message").eq("venue_booking_id", h.id).eq("type", "hold_expiry_changed");
      const msg = (data as { message: string }[])[0].message;
      expect(msg).toMatch(/IT-hold-msg/);
      expect(msg).toMatch(/now expires at/);
    });
  });
});
