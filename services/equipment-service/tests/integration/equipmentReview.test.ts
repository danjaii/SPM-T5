import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseEquipmentRequestReader } from "../../src/readers/equipmentRequestReader";
import { SupabaseEquipmentRequestReviewer } from "../../src/writers/equipmentRequestWriter";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-87: migrations 26 and 27 against a real Postgres, through the real reader and reviewer, signed in as seeded
 * users so RLS applies. These are the checks the unit tests cannot make: review_equipment_request() refuses
 * everyone but Technical Support Staff, checks availability and saves in one step, and a coordinator cannot change a
 * status by updating the row directly. Fixtures are made with the secret key, prefixed "IT-87", and removed afterwards.
 */
const RACHEL = "rachel.tan@connectsphere.example.com"; // event_coordinator, assigned to the test events
const AARON = "aaron.koh@connectsphere.example.com"; // technical_support_staff
const ORGANISER = "jason.chua@techconnect.example.com"; // event_organiser

// A far-future day (SCRUM-86's suite uses 2033), and the suite's own venue and items, so nothing overlaps.
const at = (day: number, hour: number) => new Date(Date.UTC(2034, 4, day, hour, 0, 0));

describe.skipIf(!hasDb)("SCRUM-87 reviewing equipment requests (migrations 26, 27)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const eventIds: string[] = [];
  const equipmentIds: string[] = [];
  let venueId: string;
  let rachel: Actor;
  let aaron: Actor;
  let organiserId: string;
  let day = 1;

  /** An event assigned to Rachel, with an approved venue booking, and an item with `total` units. */
  async function newRequest({ eventStatus = "planning", status = "requested", quantity = 2, total = 5 } = {}) {
    const d = day++;
    const { data: event, error } = await admin
      .from("events")
      .insert({
        name: `IT-87 event ${d}`,
        organiser_id: organiserId,
        assigned_coordinator_id: rachel.userId,
        status: eventStatus,
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
        status: "approved",
        event_start_datetime: at(d, 1).toISOString(),
        event_end_datetime: at(d, 9).toISOString(),
      })
      .select("id")
      .single();
    if (bookingError) throw new Error(bookingError.message);

    const { data: item, error: itemError } = await admin
      .from("equipment")
      .insert({ name: `IT-87 item ${d}`, type: "Audio", total_quantity: total })
      .select("id")
      .single();
    if (itemError) throw new Error(itemError.message);
    equipmentIds.push(item.id as string);

    const { data: request, error: requestError } = await admin
      .from("equipment_reservations")
      .insert({
        event_id: event.id,
        equipment_id: item.id,
        venue_booking_id: booking.id,
        quantity_requested: quantity,
        status,
        requested_by: rachel.userId,
        start_datetime: at(d, 1).toISOString(),
        end_datetime: at(d, 9).toISOString(),
      })
      .select("id")
      .single();
    if (requestError) throw new Error(requestError.message);
    return { id: request.id as string, eventId: event.id as string, equipmentId: item.id as string, day: d };
  }

  const rowOf = async (id: string) => (await admin.from("equipment_reservations").select("*").eq("id", id).single()).data;
  const review = (by: Actor, requestId: string, dbStatus: string, reason: string | null = null) =>
    new SupabaseEquipmentRequestReviewer(by.client).review({ requestId, dbStatus, reason });

  beforeAll(async () => {
    let organiser: Actor;
    [rachel, aaron, organiser] = await Promise.all([signInAs(RACHEL), signInAs(AARON), signInAs(ORGANISER)]);
    organiserId = organiser.userId;
    const { data, error } = await admin
      .from("venues")
      .insert({ name: "IT-87 Hall", address: "1 Test Street", max_capacity: 100 })
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

  it("SCRUM-87/AC1,AC3 Technical Support Staff read waiting requests with the event and the venue name", async () => {
    const r = await newRequest();
    const reader = new SupabaseEquipmentRequestReader(aaron.client);

    expect((await reader.waiting()).map((w) => w.id)).toContain(r.id);
    // The venue name needs migration 27's venue_bookings policy: staff could not read venue bookings before.
    expect(await reader.find(r.id)).toMatchObject({
      eventName: `IT-87 event ${r.day}`,
      eventStatus: "planning",
      venueName: "IT-87 Hall",
      status: "requested",
      start: at(r.day, 1),
      end: at(r.day, 9),
    });
  });

  it("SCRUM-87/AC4 Under Review is saved with who reviewed it and when", async () => {
    const r = await newRequest();
    expect(await review(aaron, r.id, "under_review")).toEqual({ outcome: "updated" });
    const row = await rowOf(r.id);
    expect(row).toMatchObject({ status: "under_review", reviewed_by: aaron.userId, quantity_reserved: null, review_reason: null });
    expect(row.reviewed_at).not.toBeNull();
  });

  it("SCRUM-87/AC4 Arranged is saved as approved, holding the quantity asked for", async () => {
    const r = await newRequest({ status: "under_review", quantity: 3, total: 3 });
    expect(await review(aaron, r.id, "approved")).toEqual({ outcome: "updated" });
    expect(await rowOf(r.id)).toMatchObject({ status: "approved", quantity_reserved: 3 });
  });

  it("SCRUM-87 decision: Arranged is refused when too few units are free, and nothing changes", async () => {
    const r = await newRequest({ quantity: 4, total: 5 });
    // Two units already reserved for another event in the same period.
    const { error } = await admin.from("equipment_reservations").insert({
      event_id: r.eventId,
      equipment_id: r.equipmentId,
      quantity_requested: 2,
      quantity_reserved: 2,
      status: "reserved",
      start_datetime: at(r.day, 3).toISOString(),
      end_datetime: at(r.day, 5).toISOString(),
    });
    if (error) throw new Error(error.message);

    expect(await review(aaron, r.id, "approved")).toEqual({ outcome: "insufficient", available: 3 });
    expect(await rowOf(r.id)).toMatchObject({ status: "requested", quantity_reserved: null, reviewed_by: null });
  });

  it("SCRUM-87/AC5 Cannot Fulfil saves the trimmed reason; without one the database refuses", async () => {
    const r = await newRequest();
    await expect(review(aaron, r.id, "rejected", "   ")).rejects.toThrow(/Give a reason/);
    expect((await rowOf(r.id)).status).toBe("requested");

    expect(await review(aaron, r.id, "rejected", "  All out on loan ")).toEqual({ outcome: "updated" });
    expect(await rowOf(r.id)).toMatchObject({ status: "rejected", review_reason: "All out on loan" });
  });

  it("SCRUM-87/AC4 only Submitted or Under Review requests can be changed", async () => {
    const r = await newRequest({ status: "approved" });
    expect(await review(aaron, r.id, "under_review")).toEqual({ outcome: "not_reviewable" });
    expect((await rowOf(r.id)).status).toBe("approved");
  });

  it("SCRUM-87 decision: a finished event's requests are left as they are", async () => {
    const r = await newRequest({ eventStatus: "cancelled" });
    expect(await review(aaron, r.id, "under_review")).toEqual({ outcome: "event_locked" });
  });

  it("a request that does not exist is not_found; a status staff cannot choose is refused", async () => {
    expect(await review(aaron, randomUUID(), "under_review")).toEqual({ outcome: "not_found" });
    const r = await newRequest();
    await expect(review(aaron, r.id, "reserved")).rejects.toThrow(/Under Review, Arranged or Cannot Fulfil/);
  });

  it("SCRUM-87/AC7 a coordinator cannot review, nor change the status by updating the row directly", async () => {
    const r = await newRequest();
    await expect(review(rachel, r.id, "approved")).rejects.toThrow(/Only Technical Support Staff/);

    // The blanket policy from 02_rls.sql would allow this; migration 27's restrictive policy does not.
    await rachel.client.from("equipment_reservations").update({ status: "approved" }).eq("id", r.id);
    expect((await rowOf(r.id)).status).toBe("requested");
  });
});
