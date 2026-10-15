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

  /** A registration arranged with the secret key, so RLS never gets in the way of setting up. Returns its id. */
  async function arrangeRegistration(eventId: string, attendeeId: string, status: string): Promise<string> {
    const { data, error } = await admin
      .from("event_registrations")
      .insert({ event_id: eventId, attendee_id: attendeeId, status, registration_details: DETAILS })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
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

  // -------------------------------------------------------------------------
  // SCRUM-73 — Withdrawing a registration (migration 29)
  // -------------------------------------------------------------------------
  describe("SCRUM-73 withdrawing a registration (migration 29)", () => {
    /** Withdraws as the signed-in actor, the way POST /events/my-registrations/:id/withdraw does; returns the rows changed. */
    function withdrawAs(actor: Actor, registrationId: string) {
      return actor.client
        .from("event_registrations")
        .update({ status: "withdrawn", withdrawn_at: new Date().toISOString() })
        .eq("id", registrationId)
        .select("id");
    }

    /** The registration's status as it is stored, read with the secret key so RLS can't hide it. */
    async function storedStatus(registrationId: string) {
      const { data } = await admin.from("event_registrations").select("status").eq("id", registrationId).single();
      return data?.status;
    }

    // AC6: the attendee's own Pending registration becomes Withdrawn
    it("SCRUM-73/AC6 lets an attendee withdraw their own Pending registration", async () => {
      const eventId = await newEvent();
      const registrationId = await arrangeRegistration(eventId, attendee.userId, "waitlisted");

      const { data, error } = await withdrawAs(attendee, registrationId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(await storedStatus(registrationId)).toBe("withdrawn");
    });

    // AC6: the only change an attendee may make is to Withdrawn; they can't confirm their own registration,
    // which would skip approval (as SCRUM-83/AC12 refuses an insert as Confirmed)
    it("SCRUM-73/AC6 doesn't let an attendee change their own registration to Confirmed", async () => {
      const eventId = await newEvent();
      const registrationId = await arrangeRegistration(eventId, attendee.userId, "waitlisted");

      const { error } = await attendee.client
        .from("event_registrations")
        .update({ status: "registered" })
        .eq("id", registrationId)
        .select("id");

      expect(error?.code).toBe(DENIED);
      expect(await storedStatus(registrationId)).toBe("waitlisted");
    });
    // end of AC6

    // AC2: only a Pending or Confirmed registration can be withdrawn; a Rejected one (stored as 'cancelled') stays Rejected
    it("SCRUM-73/AC2 doesn't let an attendee withdraw a Rejected registration", async () => {
      const eventId = await newEvent();
      const registrationId = await arrangeRegistration(eventId, attendee.userId, "cancelled");

      const { data } = await withdrawAs(attendee, registrationId);

      expect(data ?? []).toEqual([]);
      expect(await storedStatus(registrationId)).toBe("cancelled");
    });
    // end of AC2

    // AC8: withdrawing a Confirmed registration gives its place back: the count behind "Event full" and the available
    // slots (list_public_events(), SCRUM-83/AC13) drops by 1, so another attendee can register while the event is upcoming
    it("SCRUM-73/AC8 frees the place of a withdrawn Confirmed registration", async () => {
      const eventId = await newEvent({ registration_capacity: 1 });
      const registrationId = await arrangeRegistration(eventId, attendee.userId, "registered");
      const before = await otherAttendee.client.rpc("list_public_events");
      expect(before.data).toContainEqual(expect.objectContaining({ id: eventId, active_registrations: 1 }));

      await withdrawAs(attendee, registrationId);

      const after = await otherAttendee.client.rpc("list_public_events");
      expect(after.data).toContainEqual(expect.objectContaining({ id: eventId, active_registrations: 0 }));
    });
    // end of AC8

    // AC1: an attendee's token also works against Supabase directly, so the database itself must refuse to let one
    // attendee withdraw another's registration (event-service refuses it too: unit test SCRUM-73/AC1)
    it("SCRUM-73/AC1 doesn't let an attendee withdraw another attendee's registration", async () => {
      const eventId = await newEvent();
      const registrationId = await arrangeRegistration(eventId, attendee.userId, "waitlisted");

      const { data } = await withdrawAs(otherAttendee, registrationId);

      expect(data ?? []).toEqual([]);
      expect(await storedStatus(registrationId)).toBe("waitlisted");
    });

    // AC1: the event's organiser can see its registrations (SCRUM-83/AC15), but withdrawing is the attendee's own
    // decision, so they can't withdraw one
    it("SCRUM-73/AC1 doesn't let the event's organiser withdraw an attendee's registration", async () => {
      const eventId = await newEvent();
      const registrationId = await arrangeRegistration(eventId, attendee.userId, "waitlisted");

      const { data } = await withdrawAs(organiser, registrationId);

      expect(data ?? []).toEqual([]);
      expect(await storedStatus(registrationId)).toBe("waitlisted");
    });

    // AC1: withdrawing can't move the registration to another attendee, which would put a Withdrawn registration in
    // their history. No .select(): returning the row would bring in the select policy, and this is about the update's own
    it("SCRUM-73/AC1 doesn't let an attendee hand their registration to another attendee while withdrawing", async () => {
      const eventId = await newEvent();
      const registrationId = await arrangeRegistration(eventId, attendee.userId, "waitlisted");

      const { error } = await attendee.client
        .from("event_registrations")
        .update({ status: "withdrawn", attendee_id: otherAttendee.userId })
        .eq("id", registrationId);

      expect(error?.code).toBe(DENIED);
      const { data: stored } = await admin
        .from("event_registrations")
        .select("attendee_id, status")
        .eq("id", registrationId)
        .single();
      expect(stored).toEqual({ attendee_id: attendee.userId, status: "waitlisted" });
    });
    // end of AC1
  });
  // end of SCRUM-73
});
// end of SCRUM-83
