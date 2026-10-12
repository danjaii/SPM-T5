import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-83: the event_registrations rules only the real database can enforce (migration 11). Signs in as a
 * seeded attendee, so inserts go through the same JWT + publishable-key path event-service uses.
 * Fixtures are created with the secret key (which bypasses RLS), prefixed "IT-", and removed afterwards.
 */
const ATTENDEE = "alicia.fernandez@example.com";
const OTHER_ATTENDEE = "bryan.ho@example.com";
const ORGANISER = "jason.chua@techconnect.example.com";
const COORDINATOR = "rachel.tan@connectsphere.example.com";

// A far-future slot, so the event is always upcoming
const START = "2031-03-03T02:00:00+00:00";
const END = "2031-03-03T04:00:00+00:00";

/** What the attendee typed into the registration form. */
const DETAILS = { name: "Alicia Fernandez", email: "alicia.fernandez@example.com", phone: "+65 9123 4567" };

/** Postgres "insufficient_privilege": an RLS WITH CHECK failure. */
const DENIED = "42501";

describe.skipIf(!hasDb)("SCRUM-83 event_registrations in the database (migration 11)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const eventIds: string[] = [];
  let attendee: Actor;
  let otherAttendee: Actor;
  let organiser: Actor; // the organiser of every event newEvent() creates
  let coordinator: Actor;

  async function newEvent(fields: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-event-${Math.random().toString(36).slice(2, 8)}`,
        organiser_id: organiser.userId,
        is_draft: false,
        status: "confirmed",
        registration_required: true,
        preferred_start_datetime: START,
        preferred_end_datetime: END,
        ...fields,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(data.id as string);
    return data.id as string;
  }

  /** A registration arranged with the secret key, so RLS never gets in the way of setting up. */
  async function arrangeRegistration(eventId: string, attendeeId: string, status: string) {
    const { error } = await admin
      .from("event_registrations")
      .insert({ event_id: eventId, attendee_id: attendeeId, status, registration_details: DETAILS });
    if (error) throw new Error(error.message);
  }

  /** Registers as the signed-in attendee, the way POST /events/:id/registrations does. */
  function registerAs(actor: Actor, eventId: string) {
    return actor.client
      .from("event_registrations")
      .insert({ event_id: eventId, attendee_id: actor.userId, status: "waitlisted", registration_details: DETAILS });
  }

  beforeAll(async () => {
    attendee = await signInAs(ATTENDEE);
    otherAttendee = await signInAs(OTHER_ATTENDEE);
    organiser = await signInAs(ORGANISER);
    coordinator = await signInAs(COORDINATOR);
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds); // cascades registrations
  });

  // AC6: after a Withdrawn registration the attendee registers again; that's a new row, and the old one stays
  it("SCRUM-83/AC6 lets an attendee register again after withdrawing, keeping the earlier registration", async () => {
    const eventId = await newEvent();
    await arrangeRegistration(eventId, attendee.userId, "withdrawn");

    const { error } = await registerAs(attendee, eventId);

    expect(error).toBeNull();
    const { data: history } = await admin
      .from("event_registrations")
      .select("status")
      .eq("event_id", eventId)
      .eq("attendee_id", attendee.userId);
    expect((history ?? []).map((row) => row.status).sort()).toEqual(["waitlisted", "withdrawn"]);
  });
  // end of AC6

  // AC5: the card shows the attendee's active registration instead of Register, even when earlier ones are in the
  // history (list_public_events() must pick the active one out of several rows, not fail)
  it("SCRUM-83/AC5 lists the attendee's active registration when they also have an earlier withdrawn one", async () => {
    const eventId = await newEvent();
    await arrangeRegistration(eventId, attendee.userId, "withdrawn");
    await arrangeRegistration(eventId, attendee.userId, "waitlisted");

    const { data, error } = await attendee.client.rpc("list_public_events");

    expect(error).toBeNull();
    expect(data).toContainEqual(expect.objectContaining({ id: eventId, my_registration_status: "waitlisted" }));
  });

  // AC5 + AC16: one active registration per attendee per event, enforced by the database itself, so even two
  // submits arriving together (both past event-service's check) leave only one; the second gets 23505, which
  // POST /events/:id/registrations turns into "You already have an active registration" (unit test SCRUM-83/AC16)
  it("SCRUM-83/AC16 refuses a second active registration for the same event", async () => {
    const eventId = await newEvent();
    await arrangeRegistration(eventId, attendee.userId, "waitlisted");

    const { error } = await registerAs(attendee, eventId);

    expect(error?.code).toBe("23505");
    const { data: rows } = await admin
      .from("event_registrations")
      .select("id")
      .eq("event_id", eventId)
      .eq("attendee_id", attendee.userId);
    expect(rows).toHaveLength(1);
  });
  // end of AC5

  // AC13: a Pending registration doesn't take a slot, so the count behind "Event full" (AC4) is Confirmed only.
  // Here a capacity-1 event with one Pending registration must still have its 1 slot free.
  it("SCRUM-83/AC13 doesn't count a Pending registration toward the event's capacity", async () => {
    const eventId = await newEvent({ registration_capacity: 1 });
    await arrangeRegistration(eventId, attendee.userId, "waitlisted");

    const { data, error } = await attendee.client.rpc("list_public_events");

    expect(error).toBeNull();
    expect(data).toContainEqual(expect.objectContaining({ id: eventId, registration_capacity: 1, active_registrations: 0 }));
  });
  // end of AC13

  // AC15: registrations hold name, email and contact number, so who may read them is RLS's job:
  // the attendee themselves, and the event's organiser and coordinator (next tests), but never another attendee
  it("SCRUM-83/AC15 doesn't let an attendee see another attendee's registration", async () => {
    const eventId = await newEvent();
    await arrangeRegistration(eventId, attendee.userId, "waitlisted");

    const { data, error } = await otherAttendee.client.from("event_registrations").select("id").eq("event_id", eventId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // AC15: the registration information page seen by the event's organiser
  it("SCRUM-83/AC15 lets the event's organiser see its registrations", async () => {
    const eventId = await newEvent();
    await arrangeRegistration(eventId, attendee.userId, "waitlisted");

    const { data, error } = await organiser.client.from("event_registrations").select("attendee_id").eq("event_id", eventId);

    expect(error).toBeNull();
    expect(data).toEqual([{ attendee_id: attendee.userId }]);
  });

  // AC15: the registration information page seen by the coordinator assigned to the event (as for venue bookings)
  it("SCRUM-83/AC15 lets the event's assigned coordinator see its registrations", async () => {
    const eventId = await newEvent({ assigned_coordinator_id: coordinator.userId });
    await arrangeRegistration(eventId, attendee.userId, "waitlisted");

    const { data, error } = await coordinator.client.from("event_registrations").select("attendee_id").eq("event_id", eventId);

    expect(error).toBeNull();
    expect(data).toEqual([{ attendee_id: attendee.userId }]);
  });
  // end of AC15

  // AC12: a registration starts as Pending. An attendee's token works against Supabase directly (not only through
  // event-service), so the database must refuse one inserted as Confirmed, which would skip approval
  it("SCRUM-83/AC12 refuses an attendee's registration inserted as Confirmed", async () => {
    const eventId = await newEvent();

    const { error } = await attendee.client
      .from("event_registrations")
      .insert({ event_id: eventId, attendee_id: attendee.userId, status: "registered", registration_details: DETAILS });

    expect(error?.code).toBe(DENIED);
  });

  // AC12: an attendee registers themselves; they can't create a registration in someone else's name
  it("SCRUM-83/AC12 refuses a registration an attendee inserts for another attendee", async () => {
    const eventId = await newEvent();

    const { error } = await attendee.client
      .from("event_registrations")
      .insert({ event_id: eventId, attendee_id: otherAttendee.userId, status: "waitlisted", registration_details: DETAILS });

    expect(error?.code).toBe(DENIED);
  });
  // end of AC12
});
// end of SCRUM-83
