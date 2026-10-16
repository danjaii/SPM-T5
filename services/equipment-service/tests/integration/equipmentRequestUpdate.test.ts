import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseEquipmentRequestReader } from "../../src/readers/equipmentRequestReader";
import { SupabaseEquipmentRequestWriter, type EquipmentRequestChange } from "../../src/writers/equipmentRequestWriter";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-88: migration 38 against a real Postgres, through the real writer and reader, signed in as seeded users so
 * RLS applies. These are the checks the unit tests cannot make: update_equipment_request() lets only the event's
 * assigned coordinator change a request, sends it back to Submitted and releases what it held, records who changed
 * it, and refuses Released equipment, finished events and other events' venues. Fixtures are made with the secret
 * key, prefixed "IT-88", and removed afterwards.
 */
const RACHEL = "rachel.tan@connectsphere.example.com"; // event_coordinator, assigned to the test events
const MARCUS = "marcus.lim@connectsphere.example.com"; // event_coordinator, not assigned
const AARON = "aaron.koh@connectsphere.example.com"; // technical_support_staff
const ORGANISER = "jason.chua@techconnect.example.com"; // event_organiser

// A far-future day (SCRUM-86 uses 2033, SCRUM-87 2034), and the suite's own venue and items, so nothing overlaps.
const at = (day: number, hour: number) => new Date(Date.UTC(2035, 4, day, hour, 0, 0));

describe.skipIf(!hasDb)("SCRUM-88 changing equipment requests (migration 38)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const eventIds: string[] = [];
  const equipmentIds: string[] = [];
  let venueId: string;
  let rachel: Actor;
  let marcus: Actor;
  let aaron: Actor;
  let organiserId: string;
  let day = 1;

  /** An event assigned to Rachel with two approved venue bookings (day d and d+1), two items, and one request. */
  async function newRequest({ eventStatus = "planning", status = "requested" } = {}) {
    const d = day;
    day += 2;
    const { data: event, error } = await admin
      .from("events")
      .insert({
        name: `IT-88 event ${d}`,
        organiser_id: organiserId,
        assigned_coordinator_id: rachel.userId,
        status: eventStatus,
        is_draft: false,
        preferred_start_datetime: at(d, 1).toISOString(),
        preferred_end_datetime: at(d + 1, 9).toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(event.id as string);

    const { data: bookings, error: bookingError } = await admin
      .from("venue_bookings")
      .insert(
        [d, d + 1].map((bd) => ({
          event_id: event.id,
          venue_id: venueId,
          status: "approved",
          event_start_datetime: at(bd, 1).toISOString(),
          event_end_datetime: at(bd, 9).toISOString(),
        })),
      )
      .select("id, event_start_datetime")
      .order("event_start_datetime");
    if (bookingError) throw new Error(bookingError.message);

    const { data: items, error: itemError } = await admin
      .from("equipment")
      .insert([1, 2].map((n) => ({ name: `IT-88 item ${d}-${n}`, type: "Audio", total_quantity: 10 })))
      .select("id");
    if (itemError) throw new Error(itemError.message);
    equipmentIds.push(...items.map((i) => i.id as string));

    const { data: request, error: requestError } = await admin
      .from("equipment_reservations")
      .insert({
        event_id: event.id,
        equipment_id: items[0].id,
        venue_booking_id: bookings[0].id,
        quantity_requested: 2,
        quantity_reserved: status === "approved" ? 2 : null,
        status,
        requested_by: rachel.userId,
        reviewed_by: status === "requested" ? null : aaron.userId,
        reviewed_at: status === "requested" ? null : new Date().toISOString(),
        review_reason: status === "rejected" ? "All out on loan" : null,
        start_datetime: at(d, 1).toISOString(),
        end_datetime: at(d, 9).toISOString(),
      })
      .select("id")
      .single();
    if (requestError) throw new Error(requestError.message);

    const change: EquipmentRequestChange = {
      requestId: request.id as string,
      equipmentId: items[1].id as string,
      quantity: 4,
      venueBookingId: bookings[1].id as string,
      notes: "  Two more on stage  ",
      start: at(d + 1, 1),
      end: at(d + 1, 9),
    };
    return { id: request.id as string, eventId: event.id as string, change };
  }

  const rowOf = async (id: string) => (await admin.from("equipment_reservations").select("*").eq("id", id).single()).data;
  const update = (by: Actor, change: EquipmentRequestChange) => new SupabaseEquipmentRequestWriter(by.client).update(change);

  beforeAll(async () => {
    let organiser: Actor;
    [rachel, marcus, aaron, organiser] = await Promise.all([signInAs(RACHEL), signInAs(MARCUS), signInAs(AARON), signInAs(ORGANISER)]);
    organiserId = organiser.userId;
    const { data, error } = await admin
      .from("venues")
      .insert({ name: "IT-88 Hall", address: "1 Test Street", max_capacity: 100 })
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

  it("SCRUM-88/AC1,AC8 the assigned coordinator's change is saved, with who changed it and when", async () => {
    const r = await newRequest();
    expect(await update(rachel, r.change)).toBe("updated");

    const row = await rowOf(r.id);
    expect(row).toMatchObject({
      equipment_id: r.change.equipmentId,
      quantity_requested: 4,
      venue_booking_id: r.change.venueBookingId,
      notes: "Two more on stage",
      status: "requested",
      last_edited_by: rachel.userId,
    });
    expect(new Date(row.start_datetime)).toEqual(r.change.start);
    expect(row.last_edited_at).not.toBeNull();

    // AC8: Technical Support Staff read who changed it by name
    expect(await new SupabaseEquipmentRequestReader(aaron.client).find(r.id)).toMatchObject({ lastChangedBy: "Rachel Tan" });
  });

  it.each(["under_review", "approved", "rejected"])("SCRUM-88/AC2 a %s request goes back to Submitted, its review cleared", async (status) => {
    const r = await newRequest({ status });
    expect(await update(rachel, r.change)).toBe("updated");
    expect(await rowOf(r.id)).toMatchObject({
      status: "requested",
      quantity_reserved: null,
      reviewed_by: null,
      reviewed_at: null,
      review_reason: null,
    });
  });

  it("SCRUM-88/AC2 changing an Arranged request releases the units it held", async () => {
    const r = await newRequest({ status: "approved" });
    const free = async () =>
      (await admin.rpc("equipment_free_units", { p_equipment_id: (await rowOf(r.id)).equipment_id, p_start: at(1, 0).toISOString(), p_end: at(60, 0).toISOString() }))
        .data as number;
    const itemBefore = (await rowOf(r.id)).equipment_id;
    const heldBefore = await free();
    await update(rachel, { ...r.change, equipmentId: itemBefore });
    expect(await free()).toBe(heldBefore + 2);
  });

  it("SCRUM-88/AC4 a request for a finished event cannot be changed", async () => {
    for (const eventStatus of ["completed", "cancelled", "rejected"]) {
      const r = await newRequest({ eventStatus });
      expect(await update(rachel, r.change)).toBe("event_locked");
      expect(await rowOf(r.id)).toMatchObject({ quantity_requested: 2, last_edited_by: null });
    }
  });

  it("SCRUM-88/AC5 after the event is moved to Marcus, Marcus can change it and Rachel cannot", async () => {
    const r = await newRequest();
    await admin.from("events").update({ assigned_coordinator_id: marcus.userId }).eq("id", r.eventId);

    await expect(update(rachel, r.change)).rejects.toThrow(/assigned coordinator/);
    expect(await update(marcus, r.change)).toBe("updated");
    expect(await rowOf(r.id)).toMatchObject({ last_edited_by: marcus.userId });
  });

  it("SCRUM-88/AC6 another coordinator, and Technical Support Staff, cannot change it", async () => {
    const r = await newRequest();
    await expect(update(marcus, r.change)).rejects.toThrow(/assigned coordinator/);
    await expect(update(aaron, r.change)).rejects.toThrow(/assigned coordinator/);
    expect(await rowOf(r.id)).toMatchObject({ quantity_requested: 2, last_edited_by: null });
  });

  it("SCRUM-88/AC6 a direct update by the coordinator still changes nothing (migration 32's policy holds)", async () => {
    const r = await newRequest();
    await rachel.client.from("equipment_reservations").update({ quantity_requested: 9 }).eq("id", r.id);
    expect((await rowOf(r.id)).quantity_requested).toBe(2);
  });

  it("SCRUM-88 decision: Released equipment cannot be changed", async () => {
    const r = await newRequest({ status: "cancelled" });
    expect(await update(rachel, r.change)).toBe("not_editable");
  });

  it("SCRUM-88/AC3 a venue booking of another event is refused, and nothing is saved", async () => {
    const r = await newRequest();
    const other = await newRequest();
    expect(await update(rachel, { ...r.change, venueBookingId: other.change.venueBookingId })).toBe("venue_invalid");
    expect(await rowOf(r.id)).toMatchObject({ quantity_requested: 2, last_edited_by: null });
  });

  it("a request that does not exist is not found", async () => {
    const r = await newRequest();
    expect(await update(rachel, { ...r.change, requestId: "00000000-0000-0000-0000-000000000000" })).toBe("not_found");
  });
});
