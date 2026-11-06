import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sgtToUtc } from "@spm-t5/shared";
import { adminClient, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-108: warnings before a tentative hold expires, and when it has, against Postgres (migration 88). The periodic check is
 * notify_hold_expiries(p_now): the tests hand it the time, so none of them moves the database clock. Fixtures are throwaway ("IT-"), dated 2030.
 */
const EMAILS = { coordinatorA: "rachel.tan@connectsphere.example.com", coordinatorB: "marcus.lim@connectsphere.example.com", venueStaff: "kenneth.wong@connectsphere.example.com" };
const DENIED = "42501";
const HOUR = 3_600_000;
type Actor = { client: SupabaseClient; userId: string };

describe.skipIf(!hasDb)("SCRUM-108 hold expiry warnings (migration 88)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const expiry = new Date(Date.now() + 48 * HOUR);
  const at = (hoursBeforeExpiry: number) => new Date(expiry.getTime() - hoursBeforeExpiry * HOUR).toISOString();

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as (keyof typeof EMAILS)[]) who[key] = await signInAs(EMAILS[key]);
  });
  afterAll(async () => {
    await fixtures.cleanup();
  });

  /** A PENDING hold with an expiry, on an event coordinator A coordinates. */
  async function hold(extra: Record<string, unknown> = {}) {
    const venueId = await fixtures.venue("IT-warn");
    const eventId = await fixtures.event("approved", who.coordinatorA.userId);
    const { data, error } = await admin
      .from("venue_bookings")
      .insert({
        event_id: eventId, venue_id: venueId, requested_by: who.coordinatorA.userId, status: "requested", hold_expires_at: expiry.toISOString(),
        event_start_datetime: sgtToUtc("2030-11-14", "10:00").toISOString(), event_end_datetime: sgtToUtc("2030-11-14", "12:00").toISOString(), ...extra,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }
  const notes = async (bookingId: string) =>
    ((await admin.from("notifications").select("user_id, type, message").eq("venue_booking_id", bookingId).in("type", ["hold_expiring", "hold_expired"])).data ?? []) as { user_id: string; type: string; message: string }[];
  const check = async (now: string) => (await admin.rpc("notify_hold_expiries", { p_now: now })).data as number;

  describe("SCRUM-108/AC1 the coordinator sets the warning time per hold", () => {
    it("SCRUM-108/AC1 starts at 24 hours and saves the coordinator's choice against that hold", async () => {
      const id = await hold();
      expect(((await admin.from("venue_bookings").select("hold_warning_minutes").eq("id", id).single()).data as { hold_warning_minutes: number }).hold_warning_minutes).toBe(1440);
      const { error } = await who.coordinatorA.client.rpc("set_hold_warning", { p_booking_id: id, p_minutes: 120 });
      expect(error).toBeNull();
      expect(((await admin.from("venue_bookings").select("hold_warning_minutes").eq("id", id).single()).data as { hold_warning_minutes: number }).hold_warning_minutes).toBe(120);
    });

    it("SCRUM-108/AC1 refuses a time outside 1 minute to 30 days (HW001)", async () => {
      const id = await hold();
      for (const minutes of [0, -5, 43201]) {
        expect((await who.coordinatorA.client.rpc("set_hold_warning", { p_booking_id: id, p_minutes: minutes })).error?.code).toBe("HW001");
      }
    });
  });

  describe("SCRUM-108/AC4, AC5 one warning, then one expiry notice, each written once", () => {
    it("SCRUM-108/AC3, AC4 writes nothing before the warning time, one warning when it is reached, and not again", async () => {
      const id = await hold();
      await check(at(25));
      expect(await notes(id)).toEqual([]);

      await check(at(23));
      const written = await notes(id);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({ user_id: who.coordinatorA.userId, type: "hold_expiring" });
      expect(written[0].message).toMatch(/expires in 23 hours/);

      await check(at(22));
      await check(at(1));
      expect(await notes(id)).toHaveLength(1);
    });

    it("SCRUM-108/AC5 writes the expiry notice once the hold has expired, and not again", async () => {
      const id = await hold();
      await check(at(23));
      await check(at(-1));
      await check(at(-2));
      const written = await notes(id);
      expect(written.map((n) => n.type).sort()).toEqual(["hold_expired", "hold_expiring"]);
      expect(written.find((n) => n.type === "hold_expired")!.message).toMatch(/no longer reserved/);
    });

    it("SCRUM-108/AC5 sends only the expiry notice when the warning was missed", async () => {
      const id = await hold();
      await check(at(-1));
      expect((await notes(id)).map((n) => n.type)).toEqual(["hold_expired"]);
    });
  });

  describe("SCRUM-108/AC6, AC7 a confirmed hold is left alone, and only the event's coordinator is told", () => {
    it("SCRUM-108/AC6 sends nothing for a hold that was confirmed before the warning time", async () => {
      const id = await hold({ status: "approved" });
      await check(at(23));
      await check(at(-1));
      expect(await notes(id)).toEqual([]);
    });

    it("SCRUM-108/AC7 tells the event's coordinator and nobody else; another coordinator cannot set its warning time", async () => {
      const id = await hold();
      await check(at(23));
      expect((await notes(id)).every((n) => n.user_id === who.coordinatorA.userId)).toBe(true);
      expect((await who.coordinatorB.client.rpc("set_hold_warning", { p_booking_id: id, p_minutes: 60 })).error?.code).toBe("P0002");
      expect((await who.venueStaff.client.rpc("set_hold_warning", { p_booking_id: id, p_minutes: 60 })).error?.code).toBe("P0002");
    });

    it("SCRUM-108/AC7 is not callable by a signed-in user: only the service role runs the check", async () => {
      const { error } = await who.coordinatorA.client.rpc("notify_hold_expiries", { p_now: at(23) });
      expect(error?.code).toBe(DENIED);
    });
  });

  describe("SCRUM-108/AC8 a changed expiry or warning time recalculates the warning", () => {
    it("SCRUM-108/AC8 warns again after Venue Staff move the expiry", async () => {
      const id = await hold();
      await check(at(23));
      expect(await notes(id)).toHaveLength(1);

      const later = new Date(expiry.getTime() + 6 * HOUR);
      expect((await who.venueStaff.client.rpc("set_hold_expiry", { p_booking_id: id, p_expires_at: later.toISOString() })).error).toBeNull();
      await check(new Date(later.getTime() - 23 * HOUR).toISOString());

      expect((await notes(id)).filter((n) => n.type === "hold_expiring")).toHaveLength(2);
    });
  });

  describe("SCRUM-108 the exact moments, a chosen warning time, and nothing double-written", () => {
    const minutesBefore = (m: number) => new Date(expiry.getTime() - m * 60_000).toISOString();
    const setWarning = (id: string, minutes: number) => who.coordinatorA.client.rpc("set_hold_warning", { p_booking_id: id, p_minutes: minutes });

    it("SCRUM-108/AC4 writes the warning at the warning moment itself and not one second before", async () => {
      const id = await hold();
      await check(new Date(expiry.getTime() - 24 * HOUR - 1000).toISOString());
      expect(await notes(id)).toEqual([]);
      await check(at(24));
      expect((await notes(id)).map((n) => n.type)).toEqual(["hold_expiring"]);
    });

    it("SCRUM-108/AC5 writes the expiry notice at the expiry moment itself and not one second before", async () => {
      const id = await hold();
      await check(new Date(expiry.getTime() - 1000).toISOString());
      expect((await notes(id)).map((n) => n.type)).toEqual(["hold_expiring"]);
      await check(expiry.toISOString());
      expect((await notes(id)).map((n) => n.type).sort()).toEqual(["hold_expired", "hold_expiring"]);
    });

    it("SCRUM-108/AC1 uses the coordinator's own warning time: nothing at 3 hours out, one at 1.9 hours with a 2 hour warning", async () => {
      const id = await hold();
      expect((await setWarning(id, 120)).error).toBeNull();
      await check(at(3));
      expect(await notes(id)).toEqual([]);
      await check(minutesBefore(114));
      expect((await notes(id)).map((n) => n.type)).toEqual(["hold_expiring"]);
    });

    it("SCRUM-108/AC8 warns again when the coordinator changes the warning time after a warning was sent", async () => {
      const id = await hold();
      await check(at(23));
      expect(await notes(id)).toHaveLength(1);
      expect((await setWarning(id, 60)).error).toBeNull();
      await check(minutesBefore(50));
      expect((await notes(id)).filter((n) => n.type === "hold_expiring")).toHaveLength(2);
    });

    it("SCRUM-108/AC6 sends no expiry notice for a hold that was confirmed after its warning, or withdrawn, rejected or cancelled", async () => {
      for (const status of ["approved", "withdrawn", "rejected", "cancelled"]) {
        const id = await hold();
        await check(at(23));
        await admin.from("venue_bookings").update({ status }).eq("id", id);
        await check(at(-1));
        expect((await notes(id)).map((n) => n.type)).toEqual(["hold_expiring"]);
      }
    });

    it("SCRUM-108/AC7 tells each event's coordinator about their own hold only, naming the venue and event", async () => {
      const own = await hold();
      const venueId = await fixtures.venue("IT-warn-b");
      const otherEvent = await fixtures.event("approved", who.coordinatorB.userId);
      const { data } = await admin.from("venue_bookings").insert({
        event_id: otherEvent, venue_id: venueId, requested_by: who.coordinatorB.userId, status: "requested", hold_expires_at: expiry.toISOString(),
        event_start_datetime: sgtToUtc("2030-11-15", "10:00").toISOString(), event_end_datetime: sgtToUtc("2030-11-15", "12:00").toISOString(),
      }).select("id").single();
      const other = data!.id as string;

      await check(at(23));

      const mine = await notes(own);
      const theirs = await notes(other);
      expect(mine).toHaveLength(1);
      expect(theirs).toHaveLength(1);
      expect(mine[0].user_id).toBe(who.coordinatorA.userId);
      expect(theirs[0].user_id).toBe(who.coordinatorB.userId);
      const row = (await admin.from("venue_bookings").select("event_id, venue_id").eq("id", own).single()).data as { event_id: string; venue_id: string };
      const eventName = (await admin.from("events").select("name").eq("id", row.event_id).single()).data!.name as string;
      const venueName = (await admin.from("venues").select("name").eq("id", row.venue_id).single()).data!.name as string;
      expect(mine[0].message).toContain(eventName);
      expect(mine[0].message).toContain(venueName);
    });

    it("SCRUM-108/AC5 says a new venue request is needed in the expiry notice", async () => {
      const id = await hold();
      await check(at(-1));
      expect((await notes(id))[0].message).toMatch(/submit a new venue request/);
    });

    it("SCRUM-108/AC4 writes one notification when two checks run at the same moment", async () => {
      const id = await hold();
      const [a, b] = await Promise.all([check(at(23)), check(at(23))]);
      expect((await notes(id)).filter((n) => n.type === "hold_expiring")).toHaveLength(1);
      expect(a + b).toBeGreaterThanOrEqual(1);
    });
  });

  describe("SCRUM-108/AC7, AC8 end to end in the database", () => {
    it("SCRUM-108/AC7 another coordinator cannot read the hold at all, so no list of theirs can show a warning about it", async () => {
      const id = await hold();
      const { data } = await who.coordinatorB.client.from("venue_bookings").select("id").eq("id", id);
      expect(data).toEqual([]);
      const mine = await who.coordinatorA.client.from("venue_bookings").select("id, hold_warning_minutes").eq("id", id);
      expect(mine.data).toHaveLength(1);
    });

    it("SCRUM-108/AC8 tells the coordinator the new expiry when Venue Staff change it, and the warning counts from the new expiry", async () => {
      const id = await hold();
      await check(at(23));
      const later = new Date(expiry.getTime() + 6 * HOUR);
      expect((await who.venueStaff.client.rpc("set_hold_expiry", { p_booking_id: id, p_expires_at: later.toISOString() })).error).toBeNull();

      const told = (await admin.from("notifications").select("user_id, type, message").eq("venue_booking_id", id).eq("type", "hold_expiry_changed")).data ?? [];
      expect(told).toHaveLength(1);
      expect(told[0].user_id).toBe(who.coordinatorA.userId);

      // 23 hours before the OLD expiry is more than 24 hours before the NEW one: no second warning yet
      await check(at(23));
      expect((await notes(id)).filter((n) => n.type === "hold_expiring")).toHaveLength(1);
      await check(new Date(later.getTime() - 23 * HOUR).toISOString());
      expect((await notes(id)).filter((n) => n.type === "hold_expiring")).toHaveLength(2);
    });
  });
});
