import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-20 against Postgres (migration 41): the event's coordinator assigns, changes and cancels on-site technical support,
 * only through the security definer functions; a trigger writes the technician's notification in the same transaction
 * (ADR 0002); the technician acknowledges it. docs/specs/technical-assignment-notifications.md. Fixtures are made with the
 * secret key, named "IT-20-", dated 2031 and removed afterwards (assignments and notifications go with their event).
 */

const EMAILS = {
  coordinator: "rachel.tan@connectsphere.example.com",
  otherCoordinator: "marcus.lim@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
  tech: "aaron.koh@connectsphere.example.com",
  otherTech: "vanessa.lee@connectsphere.example.com",
};

/** Mon 3 Mar 2031, 08:00 to 17:00 Singapore time. */
const START = "2031-03-03T00:00:00.000Z";
const END = "2031-03-03T09:00:00.000Z";

type Row = Record<string, unknown>;

describe.skipIf(!hasDb)("SCRUM-20 on-site technical support assignments (migration 41)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];
  const venueIds: string[] = [];

  beforeAll(async () => {
    for (const [key, email] of Object.entries(EMAILS)) who[key as keyof typeof EMAILS] = await signInAs(email);
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds);
    if (venueIds.length > 0) await admin.from("venues").delete().in("id", venueIds);
  });

  async function insert(table: string, row: Row): Promise<string> {
    const { data, error } = await admin.from(table).insert(row).select("id").single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data.id as string;
  }

  /** An event assigned to Rachel, with an approved venue booking at a hall of its own. */
  async function newEvent(status = "planning", name = "IT-20 Summit") {
    const eventId = await insert("events", {
      name: `${name} ${Math.random().toString(36).slice(2, 6)}`,
      organiser_id: who.organiser.userId,
      assigned_coordinator_id: who.coordinator.userId,
      status,
      is_draft: false,
      expected_attendance: 100,
      preferred_start_datetime: START,
      preferred_end_datetime: END,
    });
    eventIds.push(eventId);
    return { eventId, bookingId: await newBooking(eventId, "approved", "IT-20 Orchid Hall") };
  }

  async function newBooking(eventId: string, status: string, venueName: string): Promise<string> {
    const venueId = await insert("venues", { name: venueName, address: "1 Test Road", max_capacity: 200 });
    venueIds.push(venueId);
    return insert("venue_bookings", {
      event_id: eventId,
      venue_id: venueId,
      status,
      event_start_datetime: "2031-03-03T01:00:00+00:00",
      event_end_datetime: "2031-03-03T09:00:00+00:00",
    });
  }

  const assign = (actor: Actor, eventId: string, bookingId: string, over: Row = {}) =>
    actor.client.rpc("assign_technical_staff", {
      p_event_id: eventId,
      p_staff_id: who.tech.userId,
      p_venue_booking_id: bookingId,
      p_start: START,
      p_end: END,
      p_note: "Livestream desk",
      ...over,
    });

  const change = (actor: Actor, id: string, bookingId: string, over: Row = {}) =>
    actor.client.rpc("change_technical_assignment", {
      p_assignment_id: id,
      p_venue_booking_id: bookingId,
      p_start: START,
      p_end: END,
      p_note: "Livestream desk",
      ...over,
    });

  const cancel = (actor: Actor, id: string, reason = "Event moved online") =>
    actor.client.rpc("cancel_technical_assignment", { p_assignment_id: id, p_reason: reason });

  const acknowledge = (actor: Actor, notificationId: string) =>
    actor.client.rpc("acknowledge_technical_assignment", { p_notification_id: notificationId });

  const assignmentRow = async (id: string) =>
    (await admin.from("technical_staff_assignments").select("*").eq("id", id).single()).data as Row;
  const notificationsFor = async (assignmentId: string) =>
    ((await admin.from("notifications").select("*").eq("technical_staff_assignment_id", assignmentId).order("created_at")).data ?? []) as Row[];

  /** Assigns the technician and returns the assignment id. */
  async function assigned(eventId: string, bookingId: string): Promise<string> {
    const { data, error } = await assign(who.coordinator, eventId, bookingId);
    if (error) throw new Error(error.message);
    return data as string;
  }

  // ----------------------------------------------------------------------------
  // AC1 assigning notifies the technician
  // ----------------------------------------------------------------------------

  it("20-S1: the coordinator assigns; the technician gets one notification with the event, venue, date and time", async () => {
    const { eventId, bookingId } = await newEvent();

    const id = await assigned(eventId, bookingId);

    expect(await assignmentRow(id)).toMatchObject({
      event_id: eventId,
      venue_booking_id: bookingId,
      staff_id: who.tech.userId,
      assigned_by: who.coordinator.userId,
      role_note: "Livestream desk",
      acknowledged_at: null,
      cancelled_at: null,
    });
    const notes = await notificationsFor(id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ user_id: who.tech.userId, event_id: eventId, type: "technical_assignment_assigned", is_read: false });
    const event = (await admin.from("events").select("name").eq("id", eventId).single()).data!;
    expect(notes[0].message).toBe(`${event.name} at IT-20 Orchid Hall, 3 Mar 2031 08:00 to 17:00 (Singapore time).`);
  });

  it("20-S1: the technician can read their assignment and open its event", async () => {
    const { eventId, bookingId } = await newEvent();
    const id = await assigned(eventId, bookingId);

    const mine = await who.tech.client.from("technical_staff_assignments").select("id").eq("id", id);
    const event = await who.tech.client.from("events").select("id").eq("id", eventId);

    expect(mine.data).toEqual([{ id }]);
    expect(event.data).toEqual([{ id: eventId }]);
  });

  it("20-S2: another coordinator, the organiser or the technician calling it directly is refused, and nobody is notified", async () => {
    const { eventId, bookingId } = await newEvent();

    for (const actor of [who.otherCoordinator, who.organiser, who.tech]) {
      expect((await assign(actor, eventId, bookingId)).error?.code).toBe("42501");
    }
    const rows = (await admin.from("technical_staff_assignments").select("id").eq("event_id", eventId)).data;
    expect(rows).toEqual([]);
  });

  it("20-S2: someone who is not Technical Support Staff, another event's or a Pending venue booking, or an end not after the start is refused", async () => {
    const { eventId, bookingId } = await newEvent();
    const other = await newEvent();
    const pending = await newBooking(eventId, "requested", "IT-20 Pending Hall");

    expect((await assign(who.coordinator, eventId, bookingId, { p_staff_id: who.otherCoordinator.userId })).error?.code).toBe("22023");
    expect((await assign(who.coordinator, eventId, other.bookingId)).error?.code).toBe("22023");
    expect((await assign(who.coordinator, eventId, pending)).error?.code).toBe("22023");
    expect((await assign(who.coordinator, eventId, bookingId, { p_end: START })).error?.code).toBe("22023");
  });

  it("20-S2: a completed event is refused (CS112)", async () => {
    const { eventId, bookingId } = await newEvent("completed");

    expect((await assign(who.coordinator, eventId, bookingId)).error?.code).toBe("CS112");
  });

  it("20-S3: the same technician twice on one venue booking is refused (23505)", async () => {
    const { eventId, bookingId } = await newEvent();
    await assigned(eventId, bookingId);

    expect((await assign(who.coordinator, eventId, bookingId)).error?.code).toBe("23505");
  });

  it("20-S1: nobody can write assignments or notifications directly", async () => {
    const { eventId, bookingId } = await newEvent();

    const direct = await who.coordinator.client.from("technical_staff_assignments").insert({
      event_id: eventId, venue_booking_id: bookingId, staff_id: who.tech.userId,
    });
    expect(direct.error?.code).toBe("42501");
  });

  // ----------------------------------------------------------------------------
  // AC2 a change notifies with the updated details
  // ----------------------------------------------------------------------------

  it("20-S4: moving it to another venue booking and new times sends one 'changed' notification and clears the acknowledgement", async () => {
    const { eventId, bookingId } = await newEvent();
    const lotus = await newBooking(eventId, "approved", "IT-20 Lotus Room");
    const id = await assigned(eventId, bookingId);
    const [first] = await notificationsFor(id);
    expect((await acknowledge(who.tech, first.id as string)).error).toBeNull();

    const { error } = await change(who.coordinator, id, lotus, { p_start: "2031-03-03T02:00:00.000Z", p_end: "2031-03-03T06:30:00.000Z" });

    expect(error).toBeNull();
    expect(await assignmentRow(id)).toMatchObject({ venue_booking_id: lotus, acknowledged_at: null });
    const notes = await notificationsFor(id);
    expect(notes.map((n) => n.type)).toEqual(["technical_assignment_assigned", "technical_assignment_changed"]);
    expect(notes[1].message).toContain("IT-20 Lotus Room, 3 Mar 2031 10:00 to 14:30 (Singapore time).");
  });

  it("20-S5: changing only the note saves it and notifies nobody", async () => {
    const { eventId, bookingId } = await newEvent();
    const id = await assigned(eventId, bookingId);

    await change(who.coordinator, id, bookingId, { p_note: "Bring spare cables" });

    expect((await assignmentRow(id)).role_note).toBe("Bring spare cables");
    expect(await notificationsFor(id)).toHaveLength(1);
  });

  it("20-S4: another coordinator cannot change it", async () => {
    const { eventId, bookingId } = await newEvent();
    const id = await assigned(eventId, bookingId);

    expect((await change(who.otherCoordinator, id, bookingId, { p_end: "2031-03-03T10:00:00.000Z" })).error?.code).toBe("42501");
  });

  // ----------------------------------------------------------------------------
  // AC3 cancelling notifies, with the reason
  // ----------------------------------------------------------------------------

  it("20-S6: cancelling records who, when and why, and tells the technician with the reason", async () => {
    const { eventId, bookingId } = await newEvent();
    const id = await assigned(eventId, bookingId);

    expect((await cancel(who.coordinator, id)).error).toBeNull();

    const row = await assignmentRow(id);
    expect(row).toMatchObject({ cancelled_by: who.coordinator.userId, cancellation_reason: "Event moved online" });
    expect(row.cancelled_at).not.toBeNull();
    const notes = await notificationsFor(id);
    expect(notes[1]).toMatchObject({ type: "technical_assignment_cancelled", user_id: who.tech.userId });
    expect(notes[1].message).toContain("Reason: Event moved online");
  });

  it("20-S6: a cancellation needs a reason (22023)", async () => {
    const { eventId, bookingId } = await newEvent();
    const id = await assigned(eventId, bookingId);

    expect((await cancel(who.coordinator, id, "   ")).error?.code).toBe("22023");
  });

  it("20-S7: a cancelled assignment cannot be changed or cancelled again (CS020)", async () => {
    const { eventId, bookingId } = await newEvent();
    const id = await assigned(eventId, bookingId);
    await cancel(who.coordinator, id);

    expect((await change(who.coordinator, id, bookingId, { p_end: "2031-03-03T10:00:00.000Z" })).error?.code).toBe("CS020");
    expect((await cancel(who.coordinator, id)).error?.code).toBe("CS020");
  });

  it("20-S6: after cancelling, the same technician can be assigned to that venue booking again", async () => {
    const { eventId, bookingId } = await newEvent();
    await cancel(who.coordinator, await assigned(eventId, bookingId));

    expect((await assign(who.coordinator, eventId, bookingId)).error).toBeNull();
  });

  // ----------------------------------------------------------------------------
  // AC4, AC5 acknowledging
  // ----------------------------------------------------------------------------

  it("20-S8: acknowledging marks the notification read and the assignment acknowledged", async () => {
    const { eventId, bookingId } = await newEvent();
    const id = await assigned(eventId, bookingId);
    const [note] = await notificationsFor(id);

    const { error } = await acknowledge(who.tech, note.id as string);

    expect(error).toBeNull();
    expect((await assignmentRow(id)).acknowledged_at).not.toBeNull();
    expect((await notificationsFor(id))[0].is_read).toBe(true);
  });

  it("20-S9: someone else's notification is refused as not found (P0002)", async () => {
    const { eventId, bookingId } = await newEvent();
    const [note] = await notificationsFor(await assigned(eventId, bookingId));

    expect((await acknowledge(who.otherTech, note.id as string)).error?.code).toBe("P0002");
  });

  it("20-S9: a cancelled assignment cannot be acknowledged (CS020), nor its 'cancelled' notification (22023)", async () => {
    const { eventId, bookingId } = await newEvent();
    const id = await assigned(eventId, bookingId);
    await cancel(who.coordinator, id);
    const [assignedNote, cancelledNote] = await notificationsFor(id);

    expect((await acknowledge(who.tech, assignedNote.id as string)).error?.code).toBe("CS020");
    expect((await acknowledge(who.tech, cancelledNote.id as string)).error?.code).toBe("22023");
    expect((await assignmentRow(id)).acknowledged_at).toBeNull();
  });

  it("20-S9: a notification sent before a later change is out of date (CS021); the newer one can be acknowledged", async () => {
    const { eventId, bookingId } = await newEvent();
    const id = await assigned(eventId, bookingId);
    await change(who.coordinator, id, bookingId, { p_end: "2031-03-03T10:00:00.000Z" });
    const [older, newer] = await notificationsFor(id);

    expect((await acknowledge(who.tech, older.id as string)).error?.code).toBe("CS021");
    expect((await acknowledge(who.tech, newer.id as string)).error).toBeNull();
  });

  it("20-S1: a seeded assignment still gets its event from its support request", async () => {
    const { data } = await admin.from("technical_staff_assignments").select("event_id, technical_support_request_id").not("technical_support_request_id", "is", null).limit(1).single();

    const request = (await admin.from("technical_support_requests").select("event_id").eq("id", data!.technical_support_request_id).single()).data;
    expect(data!.event_id).toBe(request!.event_id);
  });
});
