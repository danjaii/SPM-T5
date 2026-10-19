import { canRequestEquipment, EVENT_STATUSES, isRequestableVenueBooking } from "@spm-t5/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseEquipmentRequestReader } from "../../src/readers/equipmentRequestReader";
import { SupabaseVenueBookingReader } from "../../src/readers/venueBookingReader";
import { SupabaseEquipmentRequestWriter, type NewEquipmentRequest } from "../../src/writers/equipmentRequestWriter";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-86: migration 25 against a real Postgres, through the real readers and writer, signed in as seeded users so
 * RLS applies. These are the checks the unit tests cannot make: the restrictive insert policy refuses everything
 * the service would refuse, even when someone calls the database directly. Fixtures (a venue, events, bookings,
 * equipment) are made with the secret key, prefixed "IT-86", and removed afterwards.
 */
const RACHEL = "rachel.tan@connectsphere.example.com"; // event_coordinator, assigned to the test events
const MARCUS = "marcus.lim@connectsphere.example.com"; // event_coordinator, not assigned
const AARON = "aaron.koh@connectsphere.example.com"; // technical_support_staff
const ORGANISER = "jason.chua@techconnect.example.com"; // event_organiser

// A far-future day; the venue is the suite's own, so these bookings cannot overlap anyone else's.
const at = (day: number, hour: number) => new Date(Date.UTC(2033, 4, day, hour, 0, 0));

describe.skipIf(!hasDb)("SCRUM-86 equipment requests (migration 25)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const eventIds: string[] = [];
  const equipmentIds: string[] = [];
  let venueId: string;
  let organiserId: string;
  let rachel: Actor;
  let marcus: Actor;
  let aaron: Actor;
  let organiser: Actor;
  let day = 1;

  /** An event assigned to Rachel, with one venue booking in `bookingStatus`. */
  async function newEvent(status = "planning", bookingStatus = "approved") {
    const d = day++;
    const { data: event, error } = await admin
      .from("events")
      .insert({
        name: `IT-86 event ${d}`,
        organiser_id: organiserId,
        assigned_coordinator_id: rachel.userId,
        status,
        is_draft: false,
        preferred_start_datetime: at(d, 1).toISOString(),
        preferred_end_datetime: at(d, 9).toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(event.id as string);
    const { data: booking, error: bookingError } = await admin
      .from("venue_bookings")
      .insert({
        event_id: event.id,
        venue_id: venueId,
        status: bookingStatus,
        event_start_datetime: at(d, 1).toISOString(),
        event_end_datetime: at(d, 9).toISOString(),
      })
      .select("id")
      .single();
    if (bookingError) throw new Error(bookingError.message);
    return { eventId: event.id as string, bookingId: booking.id as string, day: d };
  }

  async function newEquipment(totalQuantity = 5): Promise<string> {
    const { data, error } = await admin
      .from("equipment")
      .insert({ name: `IT-86 item ${Math.random().toString(36).slice(2, 8)}`, type: "Audio", total_quantity: totalQuantity })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    equipmentIds.push(data.id as string);
    return data.id as string;
  }

  /** A valid request for the event, as the service would hand it to the writer; each test changes one thing. */
  const requestFor = (
    e: { eventId: string; bookingId: string; day: number },
    equipmentId: string,
    by: Actor,
    over: Partial<NewEquipmentRequest> = {},
  ): NewEquipmentRequest => ({
    eventId: e.eventId,
    equipmentId,
    quantity: 2,
    venueBookingId: e.bookingId,
    notes: "Two on stage",
    start: at(e.day, 1),
    end: at(e.day, 9),
    requestedBy: by.userId,
    ...over,
  });

  const rowsFor = async (eventId: string) =>
    (await admin.from("equipment_reservations").select("*").eq("event_id", eventId)).data ?? [];

  beforeAll(async () => {
    [rachel, marcus, aaron, organiser] = await Promise.all([signInAs(RACHEL), signInAs(MARCUS), signInAs(AARON), signInAs(ORGANISER)]);
    organiserId = organiser.userId;
    const { data, error } = await admin
      .from("venues")
      .insert({ name: "IT-86 Hall", address: "1 Test Street", max_capacity: 100 })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    venueId = data.id as string;
  });

  afterAll(async () => {
    if (!hasDb) return;
    await admin.from("equipment_reservations").delete().in("event_id", eventIds);
    await admin.from("venue_bookings").delete().in("event_id", eventIds);
    await admin.from("events").delete().in("id", eventIds);
    await admin.from("equipment").delete().in("id", equipmentIds);
    await admin.from("venues").delete().eq("id", venueId);
  });

  it("SCRUM-86/AC1 the assigned coordinator's request is saved as Submitted (requested), in their name", async () => {
    const e = await newEvent();
    const item = await newEquipment();
    const { id } = await new SupabaseEquipmentRequestWriter(rachel.client).create(requestFor(e, item, rachel));

    const [row] = await rowsFor(e.eventId);
    expect(row).toMatchObject({
      id,
      equipment_id: item,
      quantity_requested: 2,
      venue_booking_id: e.bookingId,
      notes: "Two on stage",
      status: "requested",
      requested_by: rachel.userId,
      quantity_reserved: null,
      reviewed_by: null,
    });
  });

  it("SCRUM-86/AC2,AC3 the event's requests read back with item, type, venue and status, oldest first", async () => {
    const e = await newEvent();
    const [mic, lights] = [await newEquipment(), await newEquipment()];
    const writer = new SupabaseEquipmentRequestWriter(rachel.client);
    await writer.create(requestFor(e, mic, rachel));
    await writer.create(requestFor(e, lights, rachel, { quantity: 1, notes: null }));

    const requests = await new SupabaseEquipmentRequestReader(rachel.client).forEvent(e.eventId);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ equipmentType: "Audio", quantity: 2, venueName: "IT-86 Hall", notes: "Two on stage", status: "requested" });
    expect(requests[1]).toMatchObject({ quantity: 1, notes: null, status: "requested" });
  });

  it("SCRUM-86 the form's venue list: the coordinator reads their event's bookings with the venue name", async () => {
    const e = await newEvent();
    expect(await new SupabaseVenueBookingReader(rachel.client).forEvent(e.eventId)).toEqual([
      { id: e.bookingId, eventId: e.eventId, venueName: "IT-86 Hall", status: "approved", start: at(e.day, 1), end: at(e.day, 9) },
    ]);
  });

  it.each(["completed", "cancelled", "rejected"])("SCRUM-86/AC6 no request can be saved for a %s event", async (status) => {
    const e = await newEvent(status);
    const item = await newEquipment();
    await expect(new SupabaseEquipmentRequestWriter(rachel.client).create(requestFor(e, item, rachel))).rejects.toThrow(
      /row-level security/,
    );
    expect(await rowsFor(e.eventId)).toEqual([]);
  });

  it("SCRUM-86/AC7 another coordinator cannot save a request for the event, even in their own name", async () => {
    const e = await newEvent();
    const item = await newEquipment();
    await expect(new SupabaseEquipmentRequestWriter(marcus.client).create(requestFor(e, item, marcus))).rejects.toThrow(
      /row-level security/,
    );
    expect(await rowsFor(e.eventId)).toEqual([]);
  });

  it.each([
    ["Technical Support Staff", () => aaron],
    ["the event's organiser", () => organiser],
  ])("SCRUM-86/AC7 %s cannot insert a request directly", async (_who, actor) => {
    const e = await newEvent();
    const item = await newEquipment();
    await expect(new SupabaseEquipmentRequestWriter(actor().client).create(requestFor(e, item, actor()))).rejects.toThrow(
      /row-level security/,
    );
    expect(await rowsFor(e.eventId)).toEqual([]);
  });

  it("SCRUM-86/AC1 a coordinator cannot save a request that is already arranged, or in someone else's name", async () => {
    const e = await newEvent();
    const item = await newEquipment();
    const arranged = rachel.client.from("equipment_reservations").insert({
      event_id: e.eventId,
      equipment_id: item,
      quantity_requested: 2,
      status: "reserved",
      requested_by: rachel.userId,
      start_datetime: at(e.day, 1).toISOString(),
      end_datetime: at(e.day, 9).toISOString(),
    });
    expect((await arranged).error?.message).toMatch(/row-level security/);
    await expect(
      new SupabaseEquipmentRequestWriter(rachel.client).create(requestFor(e, item, rachel, { requestedBy: marcus.userId })),
    ).rejects.toThrow(/row-level security/);
    expect(await rowsFor(e.eventId)).toEqual([]);
  });

  it("SCRUM-86 the venue must be one of this event's bookings, not another event's", async () => {
    const e = await newEvent();
    const other = await newEvent();
    const item = await newEquipment();
    await expect(
      new SupabaseEquipmentRequestWriter(rachel.client).create(requestFor(e, item, rachel, { venueBookingId: other.bookingId })),
    ).rejects.toThrow(/row-level security/);
    expect(await rowsFor(e.eventId)).toEqual([]);
  });

  // Every venue_booking_status: the database accepts exactly the bookings packages/shared offers (open question 1).
  it.each(["requested", "tentative", "approved", "confirmed", "rejected", "cancelled", "withdrawn"])(
    "SCRUM-86 a %s booking: the database agrees with isRequestableVenueBooking()",
    async (bookingStatus) => {
      const e = await newEvent("planning", bookingStatus);
      const item = await newEquipment();
      const saving = new SupabaseEquipmentRequestWriter(rachel.client).create(requestFor(e, item, rachel));
      if (isRequestableVenueBooking(bookingStatus)) await expect(saving).resolves.toEqual({ id: expect.any(String) });
      else await expect(saving).rejects.toThrow(/row-level security/);
    },
  );

  it("SCRUM-86 a new request does not reduce availability: all units can still be reserved", async () => {
    const e = await newEvent();
    const item = await newEquipment(2);
    await new SupabaseEquipmentRequestWriter(rachel.client).create(requestFor(e, item, rachel));

    const { data, error } = await aaron.client.rpc("reserve_equipment", {
      p_event_id: e.eventId,
      p_equipment_id: item,
      p_quantity: 2,
      p_start: at(e.day, 1).toISOString(),
      p_end: at(e.day, 9).toISOString(),
    });
    expect(error).toBeNull();
    expect((data as Array<{ ok: boolean }>)[0].ok).toBe(true);
  });

  it("SCRUM-86/AC6 the database's finished statuses match packages/shared for every event status", async () => {
    for (const status of EVENT_STATUSES) {
      const { data, error } = await rachel.client.rpc("equipment_request_event_open", { p_status: status });
      expect(error).toBeNull();
      expect({ status, open: data }).toEqual({ status, open: canRequestEquipment(status) });
    }
  });
});
