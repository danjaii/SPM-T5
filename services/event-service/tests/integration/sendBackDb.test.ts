import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-113 against Postgres (migration 40): confirming an important change sends the arrangements SCRUM-112 listed back
 * for review, in the same step as saving it. update_event_details(p_event_id, p_changes, p_send_back) sends the listed venue
 * bookings back to Pending and equipment requests back to Submitted, stores what changed on each, and returns a Confirmed
 * event to Planning. docs/specs/send-back-affected-arrangements.md. Fixtures are made with the secret key, named "IT-113-",
 * dated 2031 and removed afterwards.
 */

const COORDINATOR = "rachel.tan@connectsphere.example.com";
const OTHER_COORDINATOR = "marcus.lim@connectsphere.example.com";
const ORGANISER = "jason.chua@techconnect.example.com";

/** The event: Mon 7 Apr 2031, 9am to 5pm Singapore time, 480 people. */
const START = "2031-04-07T01:00:00.000Z";
const END = "2031-04-07T09:00:00.000Z";
const SLOT = { start: "2031-04-07T02:00:00+00:00", end: "2031-04-07T04:00:00+00:00" };

type Row = Record<string, unknown>;

describe.skipIf(!hasDb)("SCRUM-113 send back affected arrangements (migration 40)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  let coordinator: Actor;
  let otherCoordinator: Actor;
  let organiser: Actor;
  const eventIds: string[] = [];
  const venueIds: string[] = [];
  let equipmentId: string;

  beforeAll(async () => {
    coordinator = await signInAs(COORDINATOR);
    otherCoordinator = await signInAs(OTHER_COORDINATOR);
    organiser = await signInAs(ORGANISER);
    const equipment = await admin.from("equipment").insert({ name: "IT-113 Projector", total_quantity: 20 }).select("id").single();
    if (equipment.error) throw new Error(equipment.error.message);
    equipmentId = equipment.data.id as string;
  });

  afterAll(async () => {
    // venue bookings and equipment requests go with their event
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds);
    if (venueIds.length > 0) await admin.from("venues").delete().in("id", venueIds);
    if (equipmentId) await admin.from("equipment").delete().eq("id", equipmentId);
  });

  async function insert(table: string, row: Row): Promise<string> {
    const { data, error } = await admin.from(table).insert(row).select("id").single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data.id as string;
  }

  /** An event of the organiser, assigned to the coordinator. */
  async function newEvent(status = "planning"): Promise<string> {
    const id = await insert("events", {
      name: `IT-113-${Math.random().toString(36).slice(2, 8)}`,
      organiser_id: organiser.userId,
      assigned_coordinator_id: coordinator.userId,
      status,
      is_draft: false,
      expected_attendance: 480,
      preferred_start_datetime: START,
      preferred_end_datetime: END,
    });
    eventIds.push(id);
    return id;
  }

  /** A venue booking at a venue of its own (one venue can't be booked twice at once), reviewed if approved. */
  async function newVenueBooking(eventId: string, status = "approved"): Promise<string> {
    const venueId = await insert("venues", { name: "IT-113 Hall", address: "1 Test Road", max_capacity: 500 });
    venueIds.push(venueId);
    const decided = status === "approved" || status === "rejected";
    return insert("venue_bookings", {
      event_id: eventId,
      venue_id: venueId,
      status,
      event_start_datetime: SLOT.start,
      event_end_datetime: SLOT.end,
      snapshot_expected_attendance: 480,
      reviewed_by: decided ? coordinator.userId : null,
      reviewed_at: decided ? new Date().toISOString() : null,
      review_notes: decided ? "Looks fine" : null,
    });
  }

  /** 2 projectors; Arranged ones hold their units and were reviewed. */
  async function newEquipmentRequest(eventId: string, status = "approved"): Promise<string> {
    const arranged = status === "approved" || status === "reserved";
    return insert("equipment_reservations", {
      event_id: eventId,
      equipment_id: equipmentId,
      quantity_requested: 2,
      quantity_reserved: arranged ? 2 : null,
      status,
      start_datetime: SLOT.start,
      end_datetime: SLOT.end,
      reviewed_by: status === "requested" ? null : coordinator.userId,
      reviewed_at: status === "requested" ? null : new Date().toISOString(),
    });
  }

  const raise = (from = 480, to = 600) => ({ expected_attendance: { from, to } });

  const save = (
    actor: Actor,
    eventId: string,
    changes: Row,
    sendBack: { venue_bookings?: string[]; equipment_requests?: string[] },
  ) =>
    actor.client.rpc("update_event_details", {
      p_event_id: eventId,
      p_changes: changes,
      p_send_back: { venue_bookings: sendBack.venue_bookings ?? [], equipment_requests: sendBack.equipment_requests ?? [] },
    });

  const venueBooking = async (id: string) => (await admin.from("venue_bookings").select("*").eq("id", id).single()).data as Row;
  const equipmentRequest = async (id: string) =>
    (await admin.from("equipment_reservations").select("*").eq("id", id).single()).data as Row;
  const eventRow = async (id: string) => (await admin.from("events").select("*").eq("id", id).single()).data as Row;

  // ----------------------------------------------------------------------------
  // AC1 venue bookings back to Pending
  // ----------------------------------------------------------------------------

  it("113-S1: an approved venue booking it lists goes back to Pending, with the earlier decision cleared", async () => {
    const eventId = await newEvent();
    const bookingId = await newVenueBooking(eventId);

    const { error } = await save(coordinator, eventId, raise(), { venue_bookings: [bookingId] });

    expect(error).toBeNull();
    expect((await eventRow(eventId)).expected_attendance).toBe(600);
    expect(await venueBooking(bookingId)).toMatchObject({
      status: "requested",
      reviewed_by: null,
      reviewed_at: null,
      review_notes: null,
    });
  });

  it("113-S1: while Pending it still holds its venue, so the same venue can't be booked at that time", async () => {
    const eventId = await newEvent();
    const bookingId = await newVenueBooking(eventId);
    await save(coordinator, eventId, raise(), { venue_bookings: [bookingId] });
    const { venue_id } = await venueBooking(bookingId);

    const clash = await admin.from("venue_bookings").insert({
      event_id: eventId,
      venue_id,
      status: "requested",
      event_start_datetime: SLOT.start,
      event_end_datetime: SLOT.end,
    });

    expect(clash.error?.code).toBe("23P01");
  });

  it("113-S2: a venue booking already Pending stays Pending, now with what changed", async () => {
    const eventId = await newEvent();
    const bookingId = await newVenueBooking(eventId, "requested");

    await save(coordinator, eventId, raise(), { venue_bookings: [bookingId] });

    expect(await venueBooking(bookingId)).toMatchObject({ status: "requested", sent_back_changes: raise() });
  });

  // ----------------------------------------------------------------------------
  // AC2 equipment requests back to Submitted
  // ----------------------------------------------------------------------------

  it("113-S3: an Arranged equipment request goes back to Submitted, its units released and its review cleared", async () => {
    const eventId = await newEvent();
    const requestId = await newEquipmentRequest(eventId, "approved");

    await save(coordinator, eventId, raise(), { equipment_requests: [requestId] });

    expect(await equipmentRequest(requestId)).toMatchObject({
      status: "requested",
      quantity_reserved: null,
      reviewed_by: null,
      reviewed_at: null,
      review_reason: null,
    });
  });

  it("113-S3: an equipment request Under Review goes back to Submitted too", async () => {
    const eventId = await newEvent();
    const requestId = await newEquipmentRequest(eventId, "under_review");

    await save(coordinator, eventId, raise(), { equipment_requests: [requestId] });

    expect((await equipmentRequest(requestId)).status).toBe("requested");
  });

  // ----------------------------------------------------------------------------
  // AC3 what changed, kept on the arrangement
  // ----------------------------------------------------------------------------

  it("113-S4: each one sent back stores the event's changes and when", async () => {
    const eventId = await newEvent();
    const bookingId = await newVenueBooking(eventId);
    const requestId = await newEquipmentRequest(eventId);

    await save(coordinator, eventId, raise(), { venue_bookings: [bookingId], equipment_requests: [requestId] });

    for (const row of [await venueBooking(bookingId), await equipmentRequest(requestId)]) {
      expect(row.sent_back_changes).toEqual(raise());
      expect(new Date(row.sent_back_at as string).getTime()).toBeGreaterThan(Date.now() - 60_000);
    }
  });

  it("113-S5: sent back twice before review, each field keeps its oldest 'from' and newest 'to'", async () => {
    const eventId = await newEvent();
    const bookingId = await newVenueBooking(eventId);
    await save(coordinator, eventId, raise(480, 600), { venue_bookings: [bookingId] });

    const later = { expected_attendance: { from: 600, to: 700 }, venue_requirements: { from: null, to: "Stage" } };
    await save(coordinator, eventId, later, { venue_bookings: [bookingId] });

    expect((await venueBooking(bookingId)).sent_back_changes).toEqual({
      expected_attendance: { from: 480, to: 700 },
      venue_requirements: { from: null, to: "Stage" },
    });
  });

  it("113-S6: Venue Staff deciding it (any status change that is not a send-back) clears the note", async () => {
    const eventId = await newEvent();
    const bookingId = await newVenueBooking(eventId);
    await save(coordinator, eventId, raise(), { venue_bookings: [bookingId] });

    await admin.from("venue_bookings").update({ status: "approved" }).eq("id", bookingId);

    expect(await venueBooking(bookingId)).toMatchObject({ status: "approved", sent_back_changes: null, sent_back_at: null });
  });

  it("113-S6: the coordinator cancelling it (SCRUM-102) clears the note", async () => {
    const eventId = await newEvent();
    const bookingId = await newVenueBooking(eventId);
    await save(coordinator, eventId, raise(), { venue_bookings: [bookingId] });

    const { error } = await coordinator.client.rpc("cancel_venue_booking", { p_booking_id: bookingId, p_reason: "No longer needed" });

    expect(error).toBeNull();
    expect(await venueBooking(bookingId)).toMatchObject({ status: "cancelled", sent_back_changes: null });
  });

  it("113-S6: Technical Support Staff reviewing an equipment request clears its note", async () => {
    const eventId = await newEvent();
    const requestId = await newEquipmentRequest(eventId);
    await save(coordinator, eventId, raise(), { equipment_requests: [requestId] });

    await admin.from("equipment_reservations").update({ status: "under_review" }).eq("id", requestId);

    expect(await equipmentRequest(requestId)).toMatchObject({ status: "under_review", sent_back_changes: null, sent_back_at: null });
  });

  // ----------------------------------------------------------------------------
  // AC4 a Confirmed event back to Planning
  // ----------------------------------------------------------------------------

  it("113-S9: a Confirmed event goes back to Planning when something is sent back, recorded in its status history", async () => {
    const eventId = await newEvent("confirmed");
    const bookingId = await newVenueBooking(eventId);

    await save(coordinator, eventId, raise(), { venue_bookings: [bookingId] });

    expect((await eventRow(eventId)).status).toBe("planning");
    const history = (await admin.from("event_status_history").select("*").eq("event_id", eventId)).data ?? [];
    expect(history).toEqual([
      expect.objectContaining({ old_status: "confirmed", new_status: "planning", changed_by: coordinator.userId }),
    ]);
  });

  it("113-S10: a Confirmed event stays Confirmed when nothing is sent back", async () => {
    const eventId = await newEvent("confirmed");
    await newVenueBooking(eventId);

    await save(coordinator, eventId, { venue_requirements: { from: null, to: "Stage" } }, {});

    expect((await eventRow(eventId)).status).toBe("confirmed");
  });

  // ----------------------------------------------------------------------------
  // AC5 nothing else is touched
  // ----------------------------------------------------------------------------

  it("113-S11: arrangements it does not list keep their status and get no note", async () => {
    const eventId = await newEvent();
    const listed = await newVenueBooking(eventId);
    const unlisted = await newVenueBooking(eventId);
    const equipment = await newEquipmentRequest(eventId);

    await save(coordinator, eventId, raise(), { venue_bookings: [listed] });

    expect(await venueBooking(unlisted)).toMatchObject({ status: "approved", sent_back_changes: null });
    expect(await equipmentRequest(equipment)).toMatchObject({ status: "approved", quantity_reserved: 2, sent_back_changes: null });
  });

  it("113-S12: rejected, cancelled or released ones, and another event's, are left alone even if listed", async () => {
    const eventId = await newEvent("confirmed");
    const otherEventId = await newEvent();
    const rejected = await newVenueBooking(eventId, "rejected");
    const cancelled = await newVenueBooking(eventId, "cancelled");
    const released = await newEquipmentRequest(eventId, "cancelled");
    const othersBooking = await newVenueBooking(otherEventId);

    const { error } = await save(coordinator, eventId, raise(), {
      venue_bookings: [rejected, cancelled, othersBooking],
      equipment_requests: [released],
    });

    expect(error).toBeNull();
    expect((await venueBooking(rejected)).status).toBe("rejected");
    expect((await venueBooking(cancelled)).status).toBe("cancelled");
    expect((await equipmentRequest(released)).status).toBe("cancelled");
    expect(await venueBooking(othersBooking)).toMatchObject({ status: "approved", sent_back_changes: null });
    // nothing was really sent back, so the Confirmed event stays Confirmed
    expect((await eventRow(eventId)).status).toBe("confirmed");
  });

  it("113-S13: another coordinator is refused, and nothing is saved or sent back", async () => {
    const eventId = await newEvent();
    const bookingId = await newVenueBooking(eventId);

    const { error } = await save(otherCoordinator, eventId, raise(), { venue_bookings: [bookingId] });

    expect(error?.code).toBe("42501");
    expect((await eventRow(eventId)).expected_attendance).toBe(480);
    expect((await venueBooking(bookingId)).status).toBe("approved");
  });

  it("113-S13: a completed event is refused (CS112), and nothing is sent back", async () => {
    const eventId = await newEvent("completed");
    const bookingId = await newVenueBooking(eventId);

    const { error } = await save(coordinator, eventId, raise(), { venue_bookings: [bookingId] });

    expect(error?.code).toBe("CS112");
    expect((await venueBooking(bookingId)).status).toBe("approved");
  });
});
