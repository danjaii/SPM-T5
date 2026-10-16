import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createSupabaseDeps } from "../../src/supabase";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-112 against Postgres: PATCH /events/:id reads the event's venue bookings (with their venues) and equipment requests
 * (with their equipment) as the coordinator, lists the ones an important change affects, and saves only when confirmed,
 * leaving the arrangements as they were. docs/specs/important-change-impact.md. Fixtures are made with the secret key,
 * named "IT-112-", dated 2031 and removed afterwards.
 */

const COORDINATOR = "rachel.tan@connectsphere.example.com";
const ORGANISER = "jason.chua@techconnect.example.com";

describe.skipIf(!hasDb)("SCRUM-112 important change impact (database)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const app = hasDb ? createApp(createSupabaseDeps()) : (undefined as never);
  let coordinator: Actor;
  let organiser: Actor;
  const eventIds: string[] = [];
  const venueIds: string[] = [];
  let equipmentId: string;

  beforeAll(async () => {
    coordinator = await signInAs(COORDINATOR);
    organiser = await signInAs(ORGANISER);
    const equipment = await admin.from("equipment").insert({ name: "IT-112 Projector", total_quantity: 10 }).select("id").single();
    if (equipment.error) throw new Error(equipment.error.message);
    equipmentId = equipment.data.id as string;
  });

  afterAll(async () => {
    // the venue bookings and equipment requests go with their event
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds);
    if (venueIds.length > 0) await admin.from("venues").delete().in("id", venueIds);
    if (equipmentId) await admin.from("equipment").delete().eq("id", equipmentId);
  });

  /**
   * An event for 480 people on Mon 3 Mar 2031, 9am to 5pm Singapore time, assigned to the coordinator, with Orchid Hall
   * (holds 500, 10am to 12pm, approved, using the event's 480) and 2 projectors for it (submitted). Each event gets its own
   * Orchid Hall, because one venue can't be booked twice for the same time.
   */
  async function newEventWithArrangements() {
    const venue = await admin
      .from("venues")
      .insert({ name: "IT-112 Orchid Hall", address: "1 Test Road", max_capacity: 500 })
      .select("id")
      .single();
    if (venue.error) throw new Error(venue.error.message);
    const venueId = venue.data.id as string;
    venueIds.push(venueId);

    const event = await admin
      .from("events")
      .insert({
        name: `IT-112-${Math.random().toString(36).slice(2, 8)}`,
        organiser_id: organiser.userId,
        assigned_coordinator_id: coordinator.userId,
        status: "planning",
        is_draft: false,
        expected_attendance: 480,
        preferred_start_datetime: "2031-03-03T01:00:00+00:00",
        preferred_end_datetime: "2031-03-03T09:00:00+00:00",
      })
      .select("id")
      .single();
    if (event.error) throw new Error(event.error.message);
    const eventId = event.data.id as string;
    eventIds.push(eventId);

    const booking = await admin
      .from("venue_bookings")
      .insert({
        event_id: eventId,
        venue_id: venueId,
        status: "approved",
        event_start_datetime: "2031-03-03T02:00:00+00:00",
        event_end_datetime: "2031-03-03T04:00:00+00:00",
        snapshot_expected_attendance: 480,
      })
      .select("id")
      .single();
    if (booking.error) throw new Error(booking.error.message);

    const equipment = await admin
      .from("equipment_reservations")
      .insert({
        event_id: eventId,
        equipment_id: equipmentId,
        venue_booking_id: booking.data.id,
        quantity_requested: 2,
        status: "requested",
        start_datetime: "2031-03-03T02:00:00+00:00",
        end_datetime: "2031-03-03T04:00:00+00:00",
      })
      .select("id")
      .single();
    if (equipment.error) throw new Error(equipment.error.message);

    return { eventId, bookingId: booking.data.id as string, equipmentRequestId: equipment.data.id as string };
  }

  /** The edit form's values, then the coordinator saves them with `changes` on top. */
  async function edit(eventId: string, changes: Record<string, unknown>) {
    const cookie = `cs_session=${coordinator.token}`;
    const form = await request(app).get(`/events/${eventId}/edit-form`).set("Cookie", cookie);
    expect(form.status).toBe(200);
    return request(app).patch(`/events/${eventId}`).set("Cookie", cookie).send({ ...form.body.values, ...changes });
  }

  const eventRow = async (id: string) => (await admin.from("events").select("*").eq("id", id).single()).data as Record<string, unknown>;

  it("112-S1, 112-S4: raising attendance to 600 lists Orchid Hall (holds 500) and saves nothing", async () => {
    const { eventId, bookingId } = await newEventWithArrangements();

    const res = await edit(eventId, { expectedAttendance: 600 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFIRM_IMPACT");
    expect(res.body.affected).toEqual([
      expect.objectContaining({
        kind: "venue_booking",
        id: bookingId,
        name: "IT-112 Orchid Hall",
        reasons: [
          "IT-112 Orchid Hall holds 500 people, but the event now expects 600. This venue booking is for 480. The venue may no longer be suitable.",
        ],
      }),
    ]);
    expect((await eventRow(eventId)).expected_attendance).toBe(480);
  });

  it("112-S2, 112-S8: moving the event a day lists the venue booking and the equipment request, by name", async () => {
    const { eventId, bookingId, equipmentRequestId } = await newEventWithArrangements();

    const res = await edit(eventId, { date: "2031-03-04", endDate: "2031-03-04" });

    expect(res.status).toBe(409);
    expect(res.body.affected).toEqual([
      expect.objectContaining({ kind: "venue_booking", id: bookingId, name: "IT-112 Orchid Hall", statusLabel: "Approved" }),
      expect.objectContaining({
        kind: "equipment_request",
        id: equipmentRequestId,
        name: "IT-112 Projector",
        quantity: 2,
        statusLabel: "Submitted",
      }),
    ]);
  });

  it("112-S14: confirming saves the change as important and leaves the venue booking and equipment request as they were", async () => {
    const { eventId, bookingId, equipmentRequestId } = await newEventWithArrangements();

    const res = await edit(eventId, { expectedAttendance: 600, confirmImpact: true });

    expect(res.status).toBe(200);
    expect((await eventRow(eventId)).expected_attendance).toBe(600);
    const history = (await admin.from("event_change_history").select("is_important").eq("event_id", eventId)).data;
    expect(history).toEqual([{ is_important: true }]);
    const booking = (await admin.from("venue_bookings").select("status").eq("id", bookingId).single()).data;
    const equipment = (await admin.from("equipment_reservations").select("status").eq("id", equipmentRequestId).single()).data;
    expect(booking).toEqual({ status: "approved" });
    expect(equipment).toEqual({ status: "requested" });
  });
});
