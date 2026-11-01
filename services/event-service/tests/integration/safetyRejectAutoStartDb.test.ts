import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-171 against Postgres: Reject returns an event to Planning, and an event starts its Operational Safety Check by
 * itself once its arrangements are confirmed (docs/specs/operational-safety-check.md). Fixtures are made with the secret
 * key, named "IT-171-", dated 2032 and removed afterwards. Approvals are made as the signed-in staff, as the services do.
 */
const EMAILS = {
  safetyOfficer: "farah.ismail@connectsphere.example.com",
  coordinator: "rachel.tan@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
  venueStaff: "kenneth.wong@connectsphere.example.com",
  technician: "aaron.koh@connectsphere.example.com",
};

const START = "2032-06-15T01:00:00+00:00";
const END = "2032-06-15T09:00:00+00:00";

describe.skipIf(!hasDb)("SCRUM-171 Reject returns to Planning and the check starts automatically (database)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];
  const venueIds: string[] = [];
  let equipmentId: string;

  beforeAll(async () => {
    for (const [key, email] of Object.entries(EMAILS)) who[key as keyof typeof EMAILS] = await signInAs(email);
    const equipment = await admin.from("equipment").insert({ name: "IT-171 PA System", total_quantity: 1000 }).select("id").single();
    if (equipment.error) throw new Error(equipment.error.message);
    equipmentId = equipment.data.id as string;
  });

  afterAll(async () => {
    // the venue bookings, equipment requests, safety checks and status history go with their event
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds);
    if (venueIds.length > 0) await admin.from("venues").delete().in("id", venueIds);
    if (equipmentId) await admin.from("equipment").delete().eq("id", equipmentId);
  });

  const must = <T>(result: { data: T; error: { message: string } | null }): T => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };

  async function eventIn(status: string) {
    const event = must(
      await admin
        .from("events")
        .insert({
          name: `IT-171-${Math.random().toString(36).slice(2, 8)}`,
          organiser_id: who.organiser.userId,
          assigned_coordinator_id: who.coordinator.userId,
          status,
          is_draft: false,
          expected_attendance: 120,
          preferred_start_datetime: START,
          preferred_end_datetime: END,
        })
        .select("id")
        .single(),
    );
    eventIds.push(event.id as string);
    return event.id as string;
  }

  /** A venue booking on its own venue, so no fixture's booking overlaps another's. */
  async function booking(eventId: string, status: string) {
    const venue = must(
      await admin.from("venues").insert({ name: "IT-171 Riverside Hall", address: "1 Test Road", max_capacity: 150 }).select("id").single(),
    );
    venueIds.push(venue.id as string);
    const row = must(
      await admin
        .from("venue_bookings")
        .insert({
          event_id: eventId,
          venue_id: venue.id,
          status,
          event_start_datetime: START,
          event_end_datetime: END,
          snapshot_expected_attendance: 120,
        })
        .select("id")
        .single(),
    );
    return row.id as string;
  }

  async function equipmentRequest(eventId: string, bookingId: string, status: string) {
    const row = must(
      await admin
        .from("equipment_reservations")
        .insert({
          event_id: eventId,
          equipment_id: equipmentId,
          venue_booking_id: bookingId,
          quantity_requested: 2,
          status,
          start_datetime: START,
          end_datetime: END,
        })
        .select("id")
        .single(),
    );
    return row.id as string;
  }

  /** An event ready for its safety check: awaiting arrangements, its venue approved and its equipment reserved. */
  async function readyEvent() {
    const eventId = await eventIn("awaiting_arrangements");
    await equipmentRequest(eventId, await booking(eventId, "approved"), "reserved");
    return eventId;
  }

  const decide = (eventId: string, decision: string, reason: string | null) =>
    who.safetyOfficer.client.rpc("record_safety_decision", { p_event_id: eventId, p_decision: decision, p_reason: reason }).single();

  const moveAs = (actor: Actor, eventId: string, status: string) =>
    actor.client.rpc("change_event_status", { p_event_id: eventId, p_new_status: status }).maybeSingle();

  const statusOf = async (eventId: string) => must(await admin.from("events").select("status").eq("id", eventId).single()).status;

  const inQueue = async (eventId: string) => {
    const queue = must(await who.safetyOfficer.client.rpc("safety_check_queue")) as { id: string }[];
    return queue.some((row) => row.id === eventId);
  };

  const historyOf = async (eventId: string) =>
    must(await admin.from("event_status_history").select("old_status, new_status, changed_by, reason").eq("event_id", eventId));

  it("SCRUM-171/AC1 a rejected event returns to Planning, recorded in its status history with the reason", async () => {
    const eventId = await readyEvent();

    const { error } = await decide(eventId, "rejected", "Fire exit blocked by the stage");

    expect(error).toBeNull();
    expect(await statusOf(eventId)).toBe("planning");
    expect(await historyOf(eventId)).toEqual([
      {
        old_status: "awaiting_arrangements",
        new_status: "planning",
        changed_by: who.safetyOfficer.userId,
        reason: "Fire exit blocked by the stage",
      },
    ]);
  });

  it("SCRUM-171/AC2 a rejected event the coordinator returns is back in the queue, and Confirmed stays blocked until a new approval", async () => {
    const eventId = await readyEvent();
    must(await decide(eventId, "rejected", "Fire exit blocked by the stage"));

    must(await moveAs(who.coordinator, eventId, "awaiting_arrangements"));

    expect(await inQueue(eventId)).toBe(true);
    expect((await moveAs(who.coordinator, eventId, "confirmed")).error?.code).toBe("SC001");

    must(await decide(eventId, "approved", null));

    expect((await moveAs(who.coordinator, eventId, "confirmed")).error).toBeNull();
    expect(await statusOf(eventId)).toBe("confirmed");
  });

  /** As venue-service does (decisionService.approve), signed in as Venue Staff. */
  const approveBooking = async (bookingId: string) =>
    must(
      await who.venueStaff.client
        .from("venue_bookings")
        .update({ status: "approved", reviewed_by: who.venueStaff.userId, reviewed_at: new Date().toISOString() })
        .eq("id", bookingId)
        .eq("status", "requested")
        .select("id")
        .single(),
    );

  /** As equipment-service does, signed in as Technical Support Staff. */
  const arrangeEquipment = async (requestId: string) => {
    const [result] = must(
      await who.technician.client.rpc("review_equipment_request", { p_request_id: requestId, p_status: "approved", p_reason: null }),
    ) as { outcome: string }[];
    expect(result.outcome).toBe("updated");
  };

  it("SCRUM-171/AC3 the last venue booking approved moves the event to Awaiting Arrangements and into the queue, recorded in its history", async () => {
    const eventId = await eventIn("planning");
    const open = await booking(eventId, "requested");
    await equipmentRequest(eventId, await booking(eventId, "approved"), "reserved");

    await approveBooking(open);

    expect(await statusOf(eventId)).toBe("awaiting_arrangements");
    expect(await inQueue(eventId)).toBe(true);
    expect(await historyOf(eventId)).toEqual([
      {
        old_status: "planning",
        new_status: "awaiting_arrangements",
        changed_by: who.venueStaff.userId,
        reason: "All venue and technical arrangements are confirmed, so the safety check has started.",
      },
    ]);
  });

  it("SCRUM-171/AC3 the last equipment request arranged moves the event to Awaiting Arrangements and into the queue", async () => {
    const eventId = await eventIn("planning");
    const open = await equipmentRequest(eventId, await booking(eventId, "approved"), "requested");

    await arrangeEquipment(open);

    expect(await statusOf(eventId)).toBe("awaiting_arrangements");
    expect(await inQueue(eventId)).toBe(true);
  });

  it("SCRUM-171/AC3 a replaced venue booking does not hold the event back", async () => {
    const eventId = await eventIn("planning");
    const replacement = await booking(eventId, "requested");
    const original = await booking(eventId, "approved");
    must(await admin.from("venue_bookings").update({ status: "replaced", replaced_by_booking_id: replacement, replaced_at: new Date().toISOString() }).eq("id", original));

    await approveBooking(replacement);

    expect(await statusOf(eventId)).toBe("awaiting_arrangements");
    expect(await inQueue(eventId)).toBe(true);
  });

  it("SCRUM-171/AC3 the event stays out of the queue when approving a replacement sends its equipment back", async () => {
    const eventId = await eventIn("planning");
    const original = await booking(eventId, "approved");
    await equipmentRequest(eventId, original, "reserved");
    // the venue becomes unavailable, which flags the booking (migration 46), so its replacement takes over when approved
    const { venue_id: venueId } = must(await admin.from("venue_bookings").select("venue_id").eq("id", original).single());
    must(await admin.from("venue_unavailability").insert({ venue_id: venueId, reason: "maintenance", start_datetime: START, end_datetime: END }));
    const replacement = await booking(eventId, "requested");
    must(await admin.from("venue_bookings").update({ amends_booking_id: original }).eq("id", replacement));

    await approveBooking(replacement);

    expect(must(await admin.from("venue_bookings").select("status").eq("id", original).single()).status).toBe("replaced");
    expect(await statusOf(eventId)).toBe("planning");
  });

  it("SCRUM-171/AC4 an event with no venue booking does not move when an equipment request is arranged", async () => {
    const eventId = await eventIn("planning");
    const cancelled = await booking(eventId, "cancelled"); // its equipment request is the only thing still active
    const request = await equipmentRequest(eventId, cancelled, "requested");

    await arrangeEquipment(request);

    expect(await statusOf(eventId)).toBe("planning");
    expect(await inQueue(eventId)).toBe(false);
  });

  it("SCRUM-171/AC4 the event does not move while another venue booking is still open", async () => {
    const eventId = await eventIn("planning");
    const first = await booking(eventId, "requested");
    await booking(eventId, "requested");

    await approveBooking(first);

    expect(await statusOf(eventId)).toBe("planning");
    expect(await inQueue(eventId)).toBe(false);
  });

  it("SCRUM-171/AC4 the event does not move while an equipment request is still open", async () => {
    const eventId = await eventIn("planning");
    const open = await booking(eventId, "requested");
    await equipmentRequest(eventId, open, "requested");

    await approveBooking(open);

    expect(await statusOf(eventId)).toBe("planning");
    expect(await inQueue(eventId)).toBe(false);
  });

  it.each([
    ["rejected", "Fire exit blocked by the stage"],
    ["changes_requested", "Move the stage clear of fire exit B"],
  ])("SCRUM-171/AC5 after %s the event stays in Planning, out of the queue, until the coordinator returns it", async (decision, reason) => {
    const eventId = await readyEvent();

    must(await decide(eventId, decision, reason));

    expect(await statusOf(eventId)).toBe("planning");
    expect(await inQueue(eventId)).toBe(false);

    must(await moveAs(who.coordinator, eventId, "awaiting_arrangements"));

    expect(await inQueue(eventId)).toBe(true);
  });
});
