import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { adminClient, DB_ENV, hasDb, signInAs, type Actor } from "./support/db";

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
  const venueIds: string[] = [];
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
    if (venueIds.length > 0) await admin.from("venues").delete().in("id", venueIds);
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
  // SCRUM-169 — Confirmed straight away up to capacity (migration 68)
  // -------------------------------------------------------------------------
  describe("SCRUM-169 confirming registrations up to capacity (migration 68)", () => {
    /** Registers as the signed-in actor, the way POST /events/:id/registrations does. */
    function registerThroughFunction(actor: Actor, eventId: string) {
      return actor.client.rpc("register_for_event", { p_event_id: eventId, p_details: DETAILS });
    }

    /** The places the event's list row says are taken. */
    async function placesTaken(eventId: string) {
      const { data } = await otherAttendee.client.rpc("list_public_events");
      return (data as { id: string; active_registrations: number }[]).find((row) => row.id === eventId)?.active_registrations;
    }

    // AC1: with a free place the registration is Confirmed at once and uses that place
    it("SCRUM-169/AC1 confirms a registration at once while places remain, and it uses a place", async () => {
      const eventId = await newEvent({ registration_capacity: 2 });

      const { data, error } = await registerThroughFunction(attendee, eventId);

      expect(error).toBeNull();
      expect(data).toBe("registered");
      expect(await placesTaken(eventId)).toBe(1);
    });

    // AC2: at capacity the registration is saved as Pending and doesn't use a place
    it("SCRUM-169/AC2 saves a registration as Pending at capacity, using no place", async () => {
      const eventId = await newEvent({ registration_capacity: 1 });
      await arrangeRegistration(eventId, otherAttendee.userId, "registered");

      const { data, error } = await registerThroughFunction(attendee, eventId);

      expect(error).toBeNull();
      expect(data).toBe("waitlisted");
      expect(await placesTaken(eventId)).toBe(1);
    });

    // AC5: two attendees on the last place at the same moment: each counts the places only after the other has finished
    it("SCRUM-169/AC5 confirms only one of two attendees registering for the last place at the same moment", async () => {
      // Repeated, because one lucky ordering would pass without the lock
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const eventId = await newEvent({ registration_capacity: 1 });

        const results = await Promise.all([registerThroughFunction(attendee, eventId), registerThroughFunction(otherAttendee, eventId)]);

        expect(results.map((result) => result.error)).toEqual([null, null]);
        expect(results.map((result) => result.data as string).sort()).toEqual(["registered", "waitlisted"]);
      }
    });

    // AC1: an attendee's token can call the function directly, and it can confirm, so it must check for itself that the
    // event is open: otherwise an attendee could confirm themselves on a private, closed or cancelled event
    it.each([
      ["a private event", { registration_required: false }],
      ["an event not yet confirmed", { status: "planning" }],
      ["a cancelled event", { status: "cancelled" }],
      ["an event whose registration has closed", { registration_closes_at: "2020-01-01T00:00:00+00:00" }],
      ["an event whose registration hasn't opened", { registration_opens_at: "2030-01-01T00:00:00+00:00" }],
      ["an event that has started", { preferred_start_datetime: "2020-01-01T00:00:00+00:00", preferred_end_datetime: "2020-01-01T02:00:00+00:00" }],
    ])("SCRUM-169/AC1 refuses to register for %s", async (_name, fields) => {
      const eventId = await newEvent(fields);

      const { error } = await registerThroughFunction(attendee, eventId);

      expect(error).toMatchObject({ code: "CS169", message: "REGISTRATION_CLOSED" });
      const { data: rows } = await admin.from("event_registrations").select("id").eq("event_id", eventId);
      expect(rows).toEqual([]);
    });

    // AC1: the one-active-registration rule still holds through the function (SCRUM-83/AC16)
    it("SCRUM-169/AC1 refuses a second active registration for the same event", async () => {
      const eventId = await newEvent();
      await registerThroughFunction(attendee, eventId);

      const { error } = await registerThroughFunction(attendee, eventId);

      expect(error?.code).toBe("23505");
    });

    /** The organiser's decision on a Pending registration, the way the decision route makes it. */
    function decideAs(actor: Actor, registrationId: string, decision: string) {
      return actor.client.rpc("decide_registration", { p_registration_id: registrationId, p_decision: decision });
    }

    async function statusOf(registrationId: string) {
      const { data } = await admin.from("event_registrations").select("status").eq("id", registrationId).single();
      return data?.status;
    }

    // AC3: the event's organiser confirms a Pending registration
    it("SCRUM-169/AC3 lets the event's organiser confirm a Pending registration, which then uses a place", async () => {
      const eventId = await newEvent({ registration_capacity: 1 });
      const registrationId = await arrangeRegistration(eventId, attendee.userId, "waitlisted");

      const { error } = await decideAs(organiser, registrationId, "confirm");

      expect(error).toBeNull();
      expect(await statusOf(registrationId)).toBe("registered");
      expect(await placesTaken(eventId)).toBe(1);
    });

    // AC3: declining is stored as 'cancelled', which every page shows as Rejected
    it("SCRUM-169/AC3 lets the event's organiser decline a Pending registration", async () => {
      const eventId = await newEvent();
      const registrationId = await arrangeRegistration(eventId, attendee.userId, "waitlisted");

      const { error } = await decideAs(organiser, registrationId, "decline");

      expect(error).toBeNull();
      expect(await statusOf(registrationId)).toBe("cancelled");
    });

    // AC3: the decision is the organiser's alone: not the attendee's, nor the assigned coordinator's, who can see the row
    it("SCRUM-169/AC3 refuses a decision from anyone but the event's organiser", async () => {
      const eventId = await newEvent({ assigned_coordinator_id: coordinator.userId });
      const registrationId = await arrangeRegistration(eventId, attendee.userId, "waitlisted");

      for (const actor of [attendee, otherAttendee, coordinator]) {
        const { error } = await decideAs(actor, registrationId, "confirm");
        expect(error).toMatchObject({ code: "CS169", message: "NOT_FOUND" });
      }
      expect(await statusOf(registrationId)).toBe("waitlisted");
    });

    // AC3: only a Pending registration is waiting for a decision
    it("SCRUM-169/AC3 refuses a decision on a registration that isn't Pending", async () => {
      const eventId = await newEvent();
      const registrationId = await arrangeRegistration(eventId, attendee.userId, "withdrawn");

      const { error } = await decideAs(organiser, registrationId, "confirm");

      expect(error).toMatchObject({ code: "CS169", message: "NOT_PENDING" });
      expect(await statusOf(registrationId)).toBe("withdrawn");
    });

    // AC3: a cancelled or completed event has nothing left to decide
    it("SCRUM-169/AC3 refuses a decision on an event that is no longer confirmed", async () => {
      const eventId = await newEvent({ status: "cancelled" });
      const registrationId = await arrangeRegistration(eventId, attendee.userId, "waitlisted");

      const { error } = await decideAs(organiser, registrationId, "confirm");

      expect(error).toMatchObject({ code: "CS169", message: "EVENT_CLOSED" });
    });

    // AC4: on a full event, confirming is refused until a place has been freed
    it("SCRUM-169/AC4 refuses to confirm on a full event, and allows it once a place has been freed", async () => {
      const eventId = await newEvent({ registration_capacity: 1 });
      const confirmedId = await arrangeRegistration(eventId, otherAttendee.userId, "registered");
      const pendingId = await arrangeRegistration(eventId, attendee.userId, "waitlisted");

      const refused = await decideAs(organiser, pendingId, "confirm");
      expect(refused.error).toMatchObject({ code: "CS169", message: "EVENT_FULL" });
      expect(await statusOf(pendingId)).toBe("waitlisted");

      await otherAttendee.client.from("event_registrations").update({ status: "withdrawn" }).eq("id", confirmedId).select("id");

      const allowed = await decideAs(organiser, pendingId, "confirm");
      expect(allowed.error).toBeNull();
      expect(await statusOf(pendingId)).toBe("registered");
    });

    // AC4: declining uses no place, so a full event doesn't stop it
    it("SCRUM-169/AC4 still lets the organiser decline on a full event", async () => {
      const eventId = await newEvent({ registration_capacity: 1 });
      await arrangeRegistration(eventId, otherAttendee.userId, "registered");
      const pendingId = await arrangeRegistration(eventId, attendee.userId, "waitlisted");

      const { error } = await decideAs(organiser, pendingId, "decline");

      expect(error).toBeNull();
      expect(await statusOf(pendingId)).toBe("cancelled");
    });

    // AC6: withdrawing frees the place, and the Pending attendee stays Pending until the organiser decides
    it("SCRUM-169/AC6 frees the place when a Confirmed attendee withdraws, and promotes no one", async () => {
      const eventId = await newEvent({ registration_capacity: 1 });
      const confirmedId = await arrangeRegistration(eventId, otherAttendee.userId, "registered");
      const pendingId = await arrangeRegistration(eventId, attendee.userId, "waitlisted");

      await otherAttendee.client.from("event_registrations").update({ status: "withdrawn" }).eq("id", confirmedId).select("id");

      expect(await statusOf(confirmedId)).toBe("withdrawn");
      expect(await placesTaken(eventId)).toBe(0);
      expect(await statusOf(pendingId)).toBe("waitlisted");
    });
  });

  // -------------------------------------------------------------------------
  // SCRUM-170 — The organiser adds a VIP past the registration cap (migration 69)
  // -------------------------------------------------------------------------
  describe("SCRUM-170 adding a VIP past the registration cap (migration 69)", () => {
    /** An event of the seeded organiser, with an approved booking for a new venue of each capacity given. */
    async function eventInVenues(capacities: number[], fields: Record<string, unknown> = {}) {
      const eventId = await newEvent(fields);
      for (const max_capacity of capacities) {
        const { data, error } = await admin
          .from("venues")
          .insert({ name: `IT-venue-${Math.random().toString(36).slice(2, 8)}`, address: "IT address", max_capacity })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        venueIds.push(data.id as string);
        const booking = await admin
          .from("venue_bookings")
          .insert({ event_id: eventId, venue_id: data.id, status: "approved", event_start_datetime: START, event_end_datetime: END });
        if (booking.error) throw new Error(booking.error.message);
      }
      return eventId;
    }

    function addVip(actor: Actor, eventId: string, email: string) {
      return actor.client.rpc("add_vip_registration", { p_event_id: eventId, p_email: email });
    }

    async function rowsOf(eventId: string, attendeeId: string) {
      const { data } = await admin.from("event_registrations").select("id, status, is_vip").eq("event_id", eventId).eq("attendee_id", attendeeId);
      return data ?? [];
    }

    async function notificationsOf(eventId: string, attendeeId: string) {
      const { data } = await admin
        .from("notifications")
        .select("type, title, message")
        .eq("event_id", eventId)
        .eq("user_id", attendeeId)
        .eq("type", "registration_status_changed");
      return data ?? [];
    }

    async function confirmedCount(eventId: string) {
      const { count } = await admin.from("event_registrations").select("id", { count: "exact", head: true }).eq("event_id", eventId).eq("status", "registered");
      return count;
    }

    // AC1: at the cap, an ordinary attendee would be Pending, but the organiser's VIP is Confirmed
    it("SCRUM-170/AC1 confirms a VIP on an event at its registration cap, while the venue has room", async () => {
      const eventId = await eventInVenues([5], { registration_capacity: 1 });
      await arrangeRegistration(eventId, otherAttendee.userId, "registered");

      const { data, error } = await addVip(organiser, eventId, ATTENDEE);

      expect(error).toBeNull();
      expect(data).toBe("registered");
      expect(await rowsOf(eventId, attendee.userId)).toEqual([expect.objectContaining({ status: "registered", is_vip: true })]);
      expect(await confirmedCount(eventId)).toBe(2);
    });

    // AC1: the VIP is told the same way an attendee is when their status changes (65's wording)
    it("SCRUM-170/AC1 notifies a new VIP once, in the words attendees get", async () => {
      const eventId = await eventInVenues([5], { registration_capacity: 1 });
      const { data: event } = await admin.from("events").select("name").eq("id", eventId).single();

      await addVip(organiser, eventId, ATTENDEE);

      expect(await notificationsOf(eventId, attendee.userId)).toEqual([
        {
          type: "registration_status_changed",
          title: "Your registration changed",
          message: `Your registration for ${event?.name} is now Confirmed.`,
        },
      ]);
    });

    // AC1: the email is found however it was typed
    it("SCRUM-170/AC1 finds the account whatever the case of the email", async () => {
      const eventId = await eventInVenues([5]);

      const { error } = await addVip(organiser, eventId, `  ${ATTENDEE.toUpperCase()} `);

      expect(error).toBeNull();
      expect(await rowsOf(eventId, attendee.userId)).toHaveLength(1);
    });

    // AC1: a VIP takes a place, so an attendee registering afterwards is still held at the cap
    it("SCRUM-170/AC1 counts a VIP toward the cap for attendees who register afterwards", async () => {
      const eventId = await eventInVenues([5], { registration_capacity: 1 });
      await addVip(organiser, eventId, ATTENDEE);

      const { data } = await otherAttendee.client.rpc("register_for_event", { p_event_id: eventId, p_details: DETAILS });

      expect(data).toBe("waitlisted");
    });

    // AC2: the venue's capacity is the limit, even for a VIP
    it("SCRUM-170/AC2 refuses a VIP who would take the event past the venue's capacity, and names the capacity", async () => {
      const eventId = await eventInVenues([1], { registration_capacity: 1 });
      await arrangeRegistration(eventId, otherAttendee.userId, "registered");

      const { error } = await addVip(organiser, eventId, ATTENDEE);

      expect(error).toMatchObject({ code: "CS170", message: "VENUE_FULL", details: "1" });
      expect(await rowsOf(eventId, attendee.userId)).toEqual([]);
    });

    // AC2 (decided with the team): with several venues everyone Confirmed must fit in each, so the smallest is the limit
    it("SCRUM-170/AC2 uses the smallest venue as the limit when the event has several", async () => {
      const eventId = await eventInVenues([50, 1]);
      await arrangeRegistration(eventId, otherAttendee.userId, "registered");

      const { error } = await addVip(organiser, eventId, ATTENDEE);

      expect(error).toMatchObject({ code: "CS170", message: "VENUE_FULL", details: "1" });
    });

    // AC2: with no approved venue there is no capacity to check against, so it isn't guessed
    it("SCRUM-170/AC2 refuses a VIP when the event has no approved venue", async () => {
      const eventId = await newEvent();

      const { error } = await addVip(organiser, eventId, ATTENDEE);

      expect(error).toMatchObject({ code: "CS170", message: "NO_VENUE" });
      expect(await rowsOf(eventId, attendee.userId)).toEqual([]);
    });

    // AC2: two VIPs at once for the last venue place: each counts after the other has finished
    it("SCRUM-170/AC2 lets only one of two simultaneous VIPs take the venue's last place", async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const eventId = await eventInVenues([1]);

        const results = await Promise.all([addVip(organiser, eventId, ATTENDEE), addVip(organiser, eventId, OTHER_ATTENDEE)]);

        expect(results.filter((result) => result.error === null)).toHaveLength(1);
        expect(results.find((result) => result.error)?.error?.message).toBe("VENUE_FULL");
        expect(await confirmedCount(eventId)).toBe(1);
      }
    });

    // AC3: the database refuses everyone but the event's organiser, whatever calls it
    it("SCRUM-170/AC3 refuses a VIP add from anyone but the event's organiser", async () => {
      const { data: others } = await admin.from("users").select("email").eq("role", "event_organiser").neq("id", organiser.userId).limit(1);
      const otherOrganiser = await signInAs(others?.[0].email as string);
      const eventId = await eventInVenues([5], { assigned_coordinator_id: coordinator.userId });

      for (const actor of [attendee, otherAttendee, otherOrganiser, coordinator]) {
        const { error } = await addVip(actor, eventId, OTHER_ATTENDEE);
        expect(error).toMatchObject({ code: "CS170", message: "NOT_FOUND" });
      }
      expect(await rowsOf(eventId, otherAttendee.userId)).toEqual([]);
    });

    // AC3: a signed-out caller can't reach the function at all
    it("SCRUM-170/AC3 can't be called without signing in", async () => {
      const eventId = await eventInVenues([5]);
      const anon = createClient(DB_ENV.url as string, DB_ENV.publishableKey as string, { auth: { persistSession: false } });

      const { error } = await anon.rpc("add_vip_registration", { p_event_id: eventId, p_email: ATTENDEE });

      expect(error).not.toBeNull();
      expect(await rowsOf(eventId, attendee.userId)).toEqual([]);
    });

    // AC4: a Pending attendee is confirmed on their existing registration, not given a second one (W9 r28)
    it("SCRUM-170/AC4 confirms a Pending attendee's own registration instead of creating a second", async () => {
      const eventId = await eventInVenues([5], { registration_capacity: 1 });
      await arrangeRegistration(eventId, otherAttendee.userId, "registered");
      const pendingId = await arrangeRegistration(eventId, attendee.userId, "waitlisted");

      const { data, error } = await addVip(organiser, eventId, ATTENDEE);

      expect(error).toBeNull();
      expect(data).toBe("registered");
      expect(await rowsOf(eventId, attendee.userId)).toEqual([{ id: pendingId, status: "registered", is_vip: true }]);
      expect(await notificationsOf(eventId, attendee.userId)).toHaveLength(1);
    });

    // AC4: someone already Confirmed has nothing to gain, and is left exactly as they were
    it("SCRUM-170/AC4 refuses an attendee who is already Confirmed and creates no second registration", async () => {
      const eventId = await eventInVenues([5]);
      const confirmedId = await arrangeRegistration(eventId, attendee.userId, "registered");

      const { error } = await addVip(organiser, eventId, ATTENDEE);

      expect(error).toMatchObject({ code: "CS170", message: "ALREADY_REGISTERED" });
      expect(await rowsOf(eventId, attendee.userId)).toEqual([{ id: confirmedId, status: "registered", is_vip: false }]);
    });

    // AC4: withdrawn history isn't an active registration, so it doesn't stand in the way (SCRUM-83/AC6)
    it("SCRUM-170/AC4 adds a new registration for an attendee who had withdrawn, keeping the earlier one", async () => {
      const eventId = await eventInVenues([5]);
      await arrangeRegistration(eventId, attendee.userId, "withdrawn");

      await addVip(organiser, eventId, ATTENDEE);

      expect((await rowsOf(eventId, attendee.userId)).map((row) => row.status).sort()).toEqual(["registered", "withdrawn"]);
    });

    // AC1: the add needs a real attendee account (the assumption agreed for this story)
    it.each(["nobody@example.com", ORGANISER])("SCRUM-170/AC1 refuses %s, which is not an attendee account", async (email) => {
      const eventId = await eventInVenues([5]);

      const { error } = await addVip(organiser, eventId, email);

      expect(error).toMatchObject({ code: "CS170", message: "ACCOUNT_NOT_FOUND" });
    });

    // AC1: only an event still taking registrations
    it.each([
      ["cancelled", { status: "cancelled" }],
      ["not confirmed", { status: "planning" }],
      ["not taking registrations", { registration_required: false }],
    ])("SCRUM-170/AC1 refuses an event that is %s", async (_name, fields) => {
      const eventId = await eventInVenues([5], fields);

      const { error } = await addVip(organiser, eventId, ATTENDEE);

      expect(error).toMatchObject({ code: "CS170", message: "EVENT_CLOSED" });
    });

    // The label is the organiser's alone: an attendee's token can't set it through Supabase directly
    it("SCRUM-170/AC1 doesn't let an attendee label their own registration as VIP", async () => {
      const eventId = await eventInVenues([5]);

      const inserted = await attendee.client
        .from("event_registrations")
        .insert({ event_id: eventId, attendee_id: attendee.userId, status: "waitlisted", is_vip: true });
      expect(inserted.error?.code).toBe(DENIED);

      const registrationId = await arrangeRegistration(eventId, attendee.userId, "waitlisted");
      const updated = await attendee.client.from("event_registrations").update({ is_vip: true }).eq("id", registrationId).select("id");
      expect(updated.error?.code).toBe(DENIED);
      expect(await rowsOf(eventId, attendee.userId)).toEqual([{ id: registrationId, status: "waitlisted", is_vip: false }]);
    });

    // A normal registration carries no label, and withdrawing still works with the narrower grants
    it("SCRUM-170/AC1 leaves a normal registration unlabelled and still lets its attendee withdraw", async () => {
      const eventId = await eventInVenues([5]);
      await attendee.client.rpc("register_for_event", { p_event_id: eventId, p_details: DETAILS });
      const [row] = await rowsOf(eventId, attendee.userId);
      expect(row.is_vip).toBe(false);

      const { data } = await attendee.client
        .from("event_registrations")
        .update({ status: "withdrawn", withdrawn_at: new Date().toISOString() })
        .eq("id", row.id)
        .select("id");

      expect(data).toHaveLength(1);
    });
  });

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
