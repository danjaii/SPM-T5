import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-174 against Postgres (docs/specs/cancel-event.md): cancelling an event needs a reason and is recorded, and its
 * venue bookings, equipment, technician assignments and pending change requests are released in the same transaction,
 * with the organiser and active attendees told why. Fixtures are made with the secret key, named "IT-174-", dated 2031
 * and removed afterwards; every check reads only rows this file made (CLAUDE.md, SCRUM-143).
 */

const EMAILS = {
  coordinator: "rachel.tan@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
  technician: "aaron.koh@connectsphere.example.com",
};

const START = "2031-03-03T01:00:00+00:00";
const END = "2031-03-03T09:00:00+00:00";

type Row = Record<string, unknown>;

describe.skipIf(!hasDb)("SCRUM-174 cancel an event (migrations 60 to 64)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];
  const venueIds: string[] = [];
  const equipmentIds: string[] = [];

  beforeAll(async () => {
    for (const [key, email] of Object.entries(EMAILS)) who[key as keyof typeof EMAILS] = await signInAs(email);
  });

  afterAll(async () => {
    // events first: their venue bookings, equipment requests and assignments go with them
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds);
    if (venueIds.length > 0) await admin.from("venues").delete().in("id", venueIds);
    if (equipmentIds.length > 0) await admin.from("equipment").delete().in("id", equipmentIds);
  });

  async function insert(table: string, row: Row): Promise<string> {
    const { data, error } = await admin.from(table).insert(row).select("id").single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data.id as string;
  }

  const suffix = () => Math.random().toString(36).slice(2, 8);

  /** A venue of this file's own, so no other test's bookings can clash with it. */
  async function venue(): Promise<string> {
    const id = await insert("venues", { name: `IT-174 Hall ${suffix()}`, address: "1 Test Road", max_capacity: 200 });
    venueIds.push(id);
    return id;
  }

  /** A venue booking for the whole event, on a venue of its own. */
  const booking = async (eventId: string, status: string, venueId?: string) =>
    insert("venue_bookings", {
      event_id: eventId,
      venue_id: venueId ?? (await venue()),
      status,
      event_start_datetime: START,
      event_end_datetime: END,
    });

  /** An equipment request for the event, for one of its venue bookings or none. */
  async function equipmentRequest(eventId: string, status: string, venueBookingId: string | null): Promise<string> {
    const equipmentId = await insert("equipment", { name: `IT-174 Projector ${suffix()}`, total_quantity: 5 });
    equipmentIds.push(equipmentId);
    return insert("equipment_reservations", {
      event_id: eventId,
      equipment_id: equipmentId,
      quantity_requested: 2,
      status,
      venue_booking_id: venueBookingId,
      start_datetime: START,
      end_datetime: END,
    });
  }

  const statusOf = async (table: string, id: string) => (await admin.from(table).select("*").eq("id", id).single()).data as Row;

  /** A Planning event on 3 Mar 2031, organised by Jason and assigned to Rachel. */
  async function planningEvent(status = "planning"): Promise<string> {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-174-${Math.random().toString(36).slice(2, 8)}`,
        organiser_id: who.organiser.userId,
        assigned_coordinator_id: who.coordinator.userId,
        status,
        is_draft: false,
        expected_attendance: 120,
        preferred_start_datetime: START,
        preferred_end_datetime: END,
      })
      .select("id")
      .single();
    if (error) throw new Error(`events: ${error.message}`);
    eventIds.push(data.id as string);
    return data.id as string;
  }

  /** What the status panel does: change_event_status() as the signed-in coordinator. */
  const changeStatus = (actor: Actor, eventId: string, status: string, reason: string | null) =>
    actor.client.rpc("change_event_status", { p_event_id: eventId, p_new_status: status, p_reason: reason }).maybeSingle();

  const eventRow = async (id: string) => (await admin.from("events").select("*").eq("id", id).single()).data as Row;
  const history = async (id: string) =>
    ((await admin.from("event_status_history").select("old_status, new_status, changed_by, reason").eq("event_id", id)).data ?? []) as Row[];

  // ----------------------------------------------------------------------------
  // AC1, AC2 a reason, recorded
  // ----------------------------------------------------------------------------

  it.each([null, "", "   "])("174-S1 SCRUM-174/AC1 refuses a cancellation with no reason (%j); the event and its history are unchanged", async (reason) => {
    const eventId = await planningEvent();

    const { error } = await changeStatus(who.coordinator, eventId, "cancelled", reason);

    expect(error?.code).toBe("22023");
    expect((await eventRow(eventId)).status).toBe("planning");
    expect(await history(eventId)).toEqual([]);
  });

  it("174-S2 SCRUM-174/AC2 cancels the event with a reason: Cancelled, stamped, and the reason in its status history", async () => {
    const eventId = await planningEvent();

    const { error } = await changeStatus(who.coordinator, eventId, "cancelled", "Organiser withdrew the event");

    expect(error).toBeNull();
    const event = await eventRow(eventId);
    expect(event.status).toBe("cancelled");
    expect(event.cancelled_at).not.toBeNull();
    expect(await history(eventId)).toEqual([
      { old_status: "planning", new_status: "cancelled", changed_by: who.coordinator.userId, reason: "Organiser withdrew the event" },
    ]);
  });

  // ----------------------------------------------------------------------------
  // AC3 venue bookings released
  // ----------------------------------------------------------------------------

  it("174-S3 SCRUM-174/AC3 cancels every active venue booking with who, when and why, and leaves a rejected one alone", async () => {
    const eventId = await planningEvent();
    const active = [await booking(eventId, "requested"), await booking(eventId, "tentative"), await booking(eventId, "approved")];
    const rejected = await booking(eventId, "rejected");

    await changeStatus(who.coordinator, eventId, "cancelled", "Organiser withdrew the event");

    for (const id of active) {
      const row = await statusOf("venue_bookings", id);
      expect(row).toMatchObject({ status: "cancelled", cancelled_by: who.coordinator.userId, cancellation_reason: "The event was cancelled." });
      expect(row.cancelled_at).not.toBeNull();
    }
    expect((await statusOf("venue_bookings", rejected)).status).toBe("rejected");
  });

  it("174-S4 SCRUM-174/AC3 frees the venue: another event can then request the hall for the same time", async () => {
    const eventId = await planningEvent();
    const hall = await venue();
    await booking(eventId, "approved", hall);
    const otherEvent = await planningEvent();
    const request = () => admin.from("venue_bookings").insert({
      event_id: otherEvent, venue_id: hall, status: "requested", event_start_datetime: START, event_end_datetime: END,
    }).select("id");

    expect((await request()).error).not.toBeNull(); // taken while the event holds it

    await changeStatus(who.coordinator, eventId, "cancelled", "Organiser withdrew the event");

    expect((await request()).error).toBeNull();
  });

  // ----------------------------------------------------------------------------
  // AC4 equipment and on-site technicians released
  // ----------------------------------------------------------------------------

  it("174-S5 SCRUM-174/AC4 releases every equipment request, arranged or not, with or without a venue booking", async () => {
    const eventId = await planningEvent();
    const approvedBooking = await booking(eventId, "approved");
    const released = [
      await equipmentRequest(eventId, "requested", approvedBooking),
      await equipmentRequest(eventId, "approved", approvedBooking),
      await equipmentRequest(eventId, "reserved", approvedBooking),
      await equipmentRequest(eventId, "requested", null),
    ];
    const rejected = await equipmentRequest(eventId, "rejected", approvedBooking);

    await changeStatus(who.coordinator, eventId, "cancelled", "Organiser withdrew the event");

    for (const id of released) expect((await statusOf("equipment_reservations", id)).status).toBe("cancelled");
    expect((await statusOf("equipment_reservations", rejected)).status).toBe("rejected");
  });

  it("174-S6 SCRUM-174/AC4 cancels an on-site technician assignment, and the technician is told", async () => {
    const eventId = await planningEvent();
    const approvedBooking = await booking(eventId, "approved");
    const assignmentId = await insert("technical_staff_assignments", {
      event_id: eventId, venue_booking_id: approvedBooking, staff_id: who.technician.userId, start_datetime: START, end_datetime: END,
    });

    await changeStatus(who.coordinator, eventId, "cancelled", "Organiser withdrew the event");

    const assignment = await statusOf("technical_staff_assignments", assignmentId);
    expect(assignment).toMatchObject({ cancelled_by: who.coordinator.userId, cancellation_reason: "The event was cancelled." });
    expect(assignment.cancelled_at).not.toBeNull();
    const told = (await admin.from("notifications").select("type").eq("event_id", eventId).eq("user_id", who.technician.userId)).data;
    expect(told?.map((n) => n.type)).toContain("technical_assignment_cancelled");
  });
});
