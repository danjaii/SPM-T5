import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseReservationWriter } from "../../src/writers/reservationWriter";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-19: reserve_equipment() (migration 12) against a real Postgres: the checks the unit tests cannot make,
 * because they use a fake writer. Signs in as seeded Technical Support Staff, so it goes through the same JWT +
 * publishable-key path equipment-service uses, and calls the function through the real SupabaseReservationWriter.
 * Fixtures (equipment, an event, reservations) are created with the secret key (which bypasses RLS), prefixed
 * "IT-", and removed afterwards. Every test makes its own equipment, so tests cannot affect each other.
 */
const AARON = "aaron.koh@connectsphere.example.com"; // technical_support_staff
const VANESSA = "vanessa.lee@connectsphere.example.com"; // technical_support_staff
const VENUE_STAFF = "kenneth.wong@connectsphere.example.com"; // venue_staff
const ORGANISER = "jason.chua@techconnect.example.com";

// A far-future day (UTC times are enough here: only the order of the instants matters)
const at = (hour: number) => new Date(Date.UTC(2031, 2, 3, hour, 0, 0));

describe.skipIf(!hasDb)("SCRUM-19 reserve_equipment() (migration 12)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const equipmentIds: string[] = [];
  const eventIds: string[] = [];
  let aaron: Actor;
  let vanessa: Actor;
  let venueStaff: Actor;
  let eventId: string;

  /** A new catalogue item, so a test's numbers are its own. */
  async function newEquipment(totalQuantity: number, operationalStatus = "available"): Promise<string> {
    const { data, error } = await admin
      .from("equipment")
      .insert({
        name: `IT-equipment-${Math.random().toString(36).slice(2, 8)}`,
        total_quantity: totalQuantity,
        operational_status: operationalStatus,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    equipmentIds.push(data.id as string);
    return data.id as string;
  }

  /** A reservation that is already there, in any status. */
  async function existing(equipmentId: string, quantity: number, from: Date, to: Date, status = "approved") {
    const { error } = await admin.from("equipment_reservations").insert({
      event_id: eventId,
      equipment_id: equipmentId,
      quantity_requested: quantity,
      quantity_reserved: quantity,
      status,
      start_datetime: from.toISOString(),
      end_datetime: to.toISOString(),
    });
    if (error) throw new Error(error.message);
  }

  async function rowsFor(equipmentId: string) {
    const { data, error } = await admin.from("equipment_reservations").select("*").eq("equipment_id", equipmentId);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  const reserve = (actor: Actor, equipmentId: string, quantity: number, from = at(1), to = at(9)) =>
    new SupabaseReservationWriter(actor.client).reserve({
      eventId,
      equipmentId,
      quantity,
      start: from,
      end: to,
      reservedBy: actor.userId,
    });

  beforeAll(async () => {
    [aaron, vanessa, venueStaff] = await Promise.all([signInAs(AARON), signInAs(VANESSA), signInAs(VENUE_STAFF)]);
    const { data: organiser, error: organiserError } = await admin.from("users").select("id").eq("email", ORGANISER).single();
    if (organiserError) throw new Error(organiserError.message);
    const { data: event, error } = await admin
      .from("events")
      .insert({
        name: "IT-event-equipment",
        organiser_id: organiser.id,
        status: "approved",
        is_draft: false,
        preferred_start_datetime: at(1).toISOString(),
        preferred_end_datetime: at(9).toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventId = event.id as string;
    eventIds.push(eventId);
  });

  afterAll(async () => {
    if (!hasDb) return;
    await admin.from("equipment_reservations").delete().in("equipment_id", equipmentIds);
    await admin.from("equipment").delete().in("id", equipmentIds);
    await admin.from("events").delete().in("id", eventIds);
  });

  // AC1 + AC2: the reservation is saved as 'reserved', made and reviewed by the signed-in staff member, and the
  // answer says how many are still free.
  it("19-S1/S2: saves a 'reserved' reservation made by the caller, and reports how many are still free", async () => {
    const equipmentId = await newEquipment(10);

    const outcome = await reserve(aaron, equipmentId, 4);

    expect(outcome).toEqual({ ok: true, id: expect.any(String), availableAfter: 6 });
    const rows = await rowsFor(equipmentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: (outcome as { id: string }).id,
      event_id: eventId,
      quantity_requested: 4,
      quantity_reserved: 4,
      status: "reserved",
      requested_by: aaron.userId,
      reviewed_by: aaron.userId,
    });
  });

  // AC3: the next reservation sees the first one's units as taken.
  it("19-S3: a second reservation counts the first one's units", async () => {
    const equipmentId = await newEquipment(10);

    await reserve(aaron, equipmentId, 4);

    expect(await reserve(aaron, equipmentId, 7)).toEqual({ ok: false, available: 6 });
    expect(await reserve(aaron, equipmentId, 6)).toMatchObject({ ok: true, availableAfter: 0 });
  });

  // AC4 + AC5: too many is refused with how many are free, and nothing is saved, so availability is unchanged.
  it("19-S4/S5: asking for more than is free is refused, and saves nothing", async () => {
    const equipmentId = await newEquipment(10);
    await existing(equipmentId, 8, at(1), at(9));

    expect(await reserve(aaron, equipmentId, 3)).toEqual({ ok: false, available: 2 });

    expect(await rowsFor(equipmentId)).toHaveLength(1); // only the one that was already there
    expect(await reserve(aaron, equipmentId, 2)).toMatchObject({ ok: true }); // and 2 are still free
  });

  // 19-S11: units out at the same time count, not every overlapping booking added up.
  it("19-S11: counts the peak at any one moment, not the sum of every overlapping reservation", async () => {
    const equipmentId = await newEquipment(10);
    // 4 units out 01:00-05:00, and 4 more 05:00-09:00: back to back, never more than 4 at once.
    await existing(equipmentId, 4, at(1), at(5));
    await existing(equipmentId, 4, at(5), at(9), "reserved");

    // Summing both would leave 2 free; the peak is 4, so 6 are free over the whole period.
    expect(await reserve(aaron, equipmentId, 7, at(1), at(9))).toEqual({ ok: false, available: 6 });
    expect(await reserve(aaron, equipmentId, 6, at(1), at(9))).toMatchObject({ ok: true, availableAfter: 0 });
  });

  it("19-S11: reservations that are not approved or reserved hold no units", async () => {
    const equipmentId = await newEquipment(10);
    for (const status of ["requested", "rejected", "cancelled"]) await existing(equipmentId, 9, at(1), at(9), status);

    expect(await reserve(aaron, equipmentId, 10)).toMatchObject({ ok: true, availableAfter: 0 });
  });

  // 19-S10: damaged, under maintenance or retired equipment has none free.
  it.each(["damaged", "under_maintenance", "retired"])(
    "19-S10: %s equipment is refused with 0 free, and saves nothing",
    async (status) => {
      const equipmentId = await newEquipment(10, status);

      expect(await reserve(aaron, equipmentId, 1)).toEqual({ ok: false, available: 0 });
      expect(await rowsFor(equipmentId)).toHaveLength(0);
    },
  );

  // 19-S12: two people reserving the last units at the same moment: exactly one gets them.
  it("19-S12: two simultaneous reservations for the last units: one succeeds, the other is refused", async () => {
    const equipmentId = await newEquipment(5);

    // Aaron and Vanessa each ask for 3 of the 5, at the same time, from two separate connections.
    const outcomes = await Promise.all([reserve(aaron, equipmentId, 3), reserve(vanessa, equipmentId, 3)]);

    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok)).toEqual([{ ok: false, available: 2 }]);
    expect(await rowsFor(equipmentId)).toHaveLength(1);
  });

  // 19-S13: the database function has its own lock on the role, besides the service's.
  it("19-S13: venue staff cannot reserve equipment, even by calling the function directly", async () => {
    const equipmentId = await newEquipment(10);

    const { error } = await venueStaff.client.rpc("reserve_equipment", {
      p_event_id: eventId,
      p_equipment_id: equipmentId,
      p_quantity: 1,
      p_start: at(1).toISOString(),
      p_end: at(9).toISOString(),
    });

    expect(error?.code).toBe("42501");
    expect(await rowsFor(equipmentId)).toHaveLength(0);
  });
});
