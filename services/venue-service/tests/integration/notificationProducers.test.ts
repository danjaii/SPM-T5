import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sgtToUtc } from "@spm-t5/shared";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";
import { DB_ENV, adminClient, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-172 against Postgres (migration 65, docs/specs/receive-notifications.md): the venue changes that notify people, written
 * by the database in the same transaction as the change (ADR 0002). Venue Staff and coordinators sign in as seeded users so the
 * policies are the real ones; the secret key only arranges fixtures and reads results. Fixtures are throwaway ("IT-") and dated
 * 2030. Counts only ever look at this suite's own events (SCRUM-143).
 */
const EMAILS = {
  staff: "kenneth.wong@connectsphere.example.com",
  rachel: "rachel.tan@connectsphere.example.com",
  marcus: "marcus.lim@connectsphere.example.com",
};
const ATTENDEE = "alicia.fernandez@example.com";
const OTHER_ATTENDEE = "bryan.ho@example.com";
const at = (date: string, time: string) => sgtToUtc(date, time);
const DAY = { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "17:00") };

type Who = keyof typeof EMAILS;
type Actor = { client: SupabaseClient; userId: string; repo: SupabaseBookingRepository };

describe.skipIf(!hasDb || !DB_ENV.publishableKey)("SCRUM-172 venue notifications (migration 65)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  const who = {} as Record<Who, Actor>;

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Who[]) {
      const { client, userId } = await signInAs(EMAILS[key]);
      who[key] = { client, userId, repo: new SupabaseBookingRepository(client) };
    }
  });
  afterAll(async () => {
    await fixtures.cleanup();
  });

  /** A booking on a new event assigned to the coordinator, arranged with the secret key. */
  async function bookingAt(venueId: string, period: { start: Date; end: Date }, coordinatorId: string, status = "approved") {
    const eventId = await fixtures.event("approved", coordinatorId);
    const { data, error } = await admin
      .from("venue_bookings")
      .insert({
        event_id: eventId,
        venue_id: venueId,
        requested_by: coordinatorId,
        status,
        event_start_datetime: period.start.toISOString(),
        event_end_datetime: period.end.toISOString(),
        snapshot_event_name: "IT",
        snapshot_expected_attendance: 120,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id as string, eventId, venueId };
  }

  /** A booking of a new venue, for Rachel's event. */
  const booking = async (status = "requested") =>
    bookingAt(await fixtures.venue("IT-venue", { max_capacity: 200 }), DAY, who.rachel.userId, status);

  const notificationsOf = async (userId: string, eventId: string, type: string) =>
    (await admin.from("notifications").select("message, venue_booking_id").eq("user_id", userId).eq("event_id", eventId).eq("type", type)).data ?? [];

  // AC2: the coordinator waiting on the decision hears it, and the notice opens the booking
  it("SCRUM-172/AC2 Venue Staff approving a booking notifies the event's assigned coordinator", async () => {
    const b = await booking();

    const decided = await who.staff.repo.decide(b.id, { outcome: "approved" }, who.staff.userId, new Date());

    expect(decided).not.toBeNull();
    const notices = await notificationsOf(who.rachel.userId, b.eventId, "venue_booking_approved");
    expect(notices).toHaveLength(1);
    expect(notices[0].venue_booking_id).toBe(b.id);
  });

  // AC2: a rejection carries the reason, so the coordinator knows what to do next
  it("SCRUM-172/AC2 Venue Staff rejecting a booking notifies the coordinator with the reason", async () => {
    const b = await booking();

    const decided = await who.staff.repo.decide(b.id, { outcome: "rejected", reason: "Closed for repainting" }, who.staff.userId, new Date());

    expect(decided).not.toBeNull();
    const notices = await notificationsOf(who.rachel.userId, b.eventId, "venue_booking_rejected");
    expect(notices).toHaveLength(1);
    expect(notices[0].message).toContain("Closed for repainting");
    expect(notices[0].venue_booking_id).toBe(b.id);
  });

  // AC2: only a decision on a Pending request, so a hold moving on decided nothing the coordinator is waiting for
  it("SCRUM-172/AC2 a status change that is not a decision notifies nobody", async () => {
    const b = await booking("tentative");

    const { error } = await admin.from("venue_bookings").update({ status: "approved" }).eq("id", b.id);

    expect(error).toBeNull();
    expect(await notificationsOf(who.rachel.userId, b.eventId, "venue_booking_approved")).toEqual([]);
    expect(await notificationsOf(who.rachel.userId, b.eventId, "venue_booking_rejected")).toEqual([]);
  });

  /** Staff's timing change, the way PUT /venues/:id/timing makes it. */
  const setTiming = (venueId: string, setup: number, turnaround: number) =>
    who.staff.client.rpc("set_venue_timing", { p_venue_id: venueId, p_setup: setup, p_turnaround: turnaround });

  // AC7: a raised buffer makes two bookings clash; each one's coordinator hears, once, whatever else it clashes with (W9 r47)
  it("SCRUM-172/AC7 a buffer change that creates a conflict notifies the coordinator of each flagged booking, once per booking", async () => {
    const venueId = await fixtures.venue("IT-venue", { max_capacity: 200 });
    const middle = await bookingAt(venueId, { start: at("2030-11-14", "12:30"), end: at("2030-11-14", "14:00") }, who.rachel.userId);
    const early = await bookingAt(venueId, { start: at("2030-11-14", "10:00"), end: at("2030-11-14", "12:00") }, who.marcus.userId);
    const late = await bookingAt(venueId, { start: at("2030-11-14", "14:30"), end: at("2030-11-14", "16:00") }, who.marcus.userId);

    const { error } = await setTiming(venueId, 30, 45);

    expect(error).toBeNull();
    const clash = (userId: string, b: { eventId: string }) => notificationsOf(userId, b.eventId, "venue_booking_flagged");
    expect(await clash(who.rachel.userId, middle)).toHaveLength(1); // clashes with both neighbours, told once
    expect(await clash(who.marcus.userId, early)).toHaveLength(1);
    expect(await clash(who.marcus.userId, late)).toHaveLength(1);
    expect((await clash(who.rachel.userId, middle))[0].venue_booking_id).toBe(middle.id);
  });

  // AC7: only a conflict the change creates. A booking that was already flagged is not news.
  it("SCRUM-172/AC7 saving the same times again notifies nobody new", async () => {
    const venueId = await fixtures.venue("IT-venue", { max_capacity: 200 });
    const a = await bookingAt(venueId, { start: at("2030-11-15", "10:00"), end: at("2030-11-15", "12:00") }, who.rachel.userId);
    await bookingAt(venueId, { start: at("2030-11-15", "12:30"), end: at("2030-11-15", "14:00") }, who.marcus.userId);

    await setTiming(venueId, 30, 45);
    const { error } = await setTiming(venueId, 30, 45);

    expect(error).toBeNull();
    expect(await notificationsOf(who.rachel.userId, a.eventId, "venue_booking_flagged")).toHaveLength(1);
  });

  // AC7: a change that creates no conflict flags nothing
  it("SCRUM-172/AC7 a buffer change with no conflict notifies nobody", async () => {
    const venueId = await fixtures.venue("IT-venue", { max_capacity: 200 });
    const a = await bookingAt(venueId, { start: at("2030-11-16", "10:00"), end: at("2030-11-16", "12:00") }, who.rachel.userId);
    await bookingAt(venueId, { start: at("2030-11-16", "16:00"), end: at("2030-11-16", "18:00") }, who.marcus.userId);

    const { error } = await setTiming(venueId, 30, 45);

    expect(error).toBeNull();
    expect(await notificationsOf(who.rachel.userId, a.eventId, "venue_booking_flagged")).toEqual([]);
  });

  /**
   * An approved booking flagged by a venue block (SCRUM-106), and a replacement requested and pending, on an event with an
   * organiser of its own and one attendee of each kind.
   */
  async function replacementReady() {
    const orchid = await fixtures.venue("IT-orchid", { max_capacity: 200 });
    const lotus = await fixtures.venue("IT-lotus", { max_capacity: 200 });
    const original = await bookingAt(orchid, DAY, who.rachel.userId);
    const marked = await who.staff.client.rpc("mark_venue_unavailable", {
      p_venue_id: orchid,
      p_start: at("2030-11-14", "08:00").toISOString(),
      p_end: at("2030-11-16", "18:00").toISOString(),
      p_reason: "maintenance",
      p_notes: null,
    });
    if (marked.error) throw new Error(marked.error.message);
    const replacement = await who.rachel.repo.insert({
      eventId: original.eventId,
      venueId: lotus,
      ...DAY,
      requestedBy: who.rachel.userId,
      snapshot: { eventName: "IT", expectedAttendance: 120, venueRequirements: null, accessibilityNeeds: null },
      amendsBookingId: original.id,
    });
    return { original, replacement };
  }

  const organiserOf = async (eventId: string) =>
    (await admin.from("events").select("organiser_id").eq("id", eventId).single()).data?.organiser_id as string;

  // AC8: the organiser and attendees must know where to go (W9 r52); the coordinator already hears the approval (AC2)
  it("SCRUM-172/AC8 a replacement venue being approved notifies the organiser, naming the new venue", async () => {
    const { original, replacement } = await replacementReady();

    const decided = await who.staff.repo.decide(replacement.id, { outcome: "approved" }, who.staff.userId, new Date());

    expect(decided).not.toBeNull();
    const [notice] = await notificationsOf(await organiserOf(original.eventId), original.eventId, "venue_replaced");
    expect(notice?.message).toContain("IT-lotus");
    expect(await notificationsOf(who.rachel.userId, original.eventId, "venue_replaced")).toEqual([]);
    expect(await notificationsOf(who.rachel.userId, original.eventId, "venue_booking_approved")).toHaveLength(1);
  });

  // AC8, AC9: attendees who still get updates hear of it (W9 r52); a withdrawn attendee does not
  it("SCRUM-172/AC8,AC9 a replacement notifies a registered attendee and not a withdrawn one", async () => {
    const { original, replacement } = await replacementReady();
    const [registered, withdrawn] = await Promise.all([signInAs(ATTENDEE), signInAs(OTHER_ATTENDEE)]);
    const details = { name: "IT-172", email: "it-172@example.com", phone: "+65 9123 4567" };
    const { error: arrange } = await admin.from("event_registrations").insert([
      { event_id: original.eventId, attendee_id: registered.userId, status: "registered", registration_details: details },
      { event_id: original.eventId, attendee_id: withdrawn.userId, status: "withdrawn", registration_details: details },
    ]);
    if (arrange) throw new Error(arrange.message);

    await who.staff.repo.decide(replacement.id, { outcome: "approved" }, who.staff.userId, new Date());

    expect(await notificationsOf(registered.userId, original.eventId, "venue_replaced")).toHaveLength(1);
    expect(await notificationsOf(withdrawn.userId, original.eventId, "venue_replaced")).toEqual([]);
  });

  // AC8: an ordinary amendment (a new request after a rejection, SCRUM-60) replaced nothing
  it("SCRUM-172/AC8 approving an ordinary amendment does not announce a replacement", async () => {
    const original = await booking("rejected");
    const amendment = await who.rachel.repo.insert({
      eventId: original.eventId,
      venueId: await fixtures.venue("IT-venue", { max_capacity: 200 }),
      ...DAY,
      requestedBy: who.rachel.userId,
      snapshot: { eventName: "IT", expectedAttendance: 120, venueRequirements: null, accessibilityNeeds: null },
      amendsBookingId: original.id,
    });

    await who.staff.repo.decide(amendment.id, { outcome: "approved" }, who.staff.userId, new Date());

    expect(await notificationsOf(await organiserOf(original.eventId), original.eventId, "venue_replaced")).toEqual([]);
  });
});
