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
});
