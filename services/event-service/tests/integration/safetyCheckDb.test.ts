import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createSupabaseDeps } from "../../src/supabase";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-99 against Postgres (migration 35, docs/specs/operational-safety-check.md): the safety check queue, details and
 * decisions, and the events_safety_gate trigger that keeps an event out of preparation (confirmed) until it is Safety
 * Approved. Fixtures are made with the secret key, named "IT-99-", dated 2031 and removed afterwards.
 */
const EMAILS = {
  safetyOfficer: "farah.ismail@connectsphere.example.com",
  coordinator: "rachel.tan@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
};

describe.skipIf(!hasDb)("SCRUM-99 Operational Safety Check (database)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];
  const venueIds: string[] = [];
  let equipmentId: string;

  beforeAll(async () => {
    for (const [key, email] of Object.entries(EMAILS)) who[key as keyof typeof EMAILS] = await signInAs(email);
    const equipment = await admin.from("equipment").insert({ name: "IT-99 PA System", total_quantity: 10 }).select("id").single();
    if (equipment.error) throw new Error(equipment.error.message);
    equipmentId = equipment.data.id as string;
  });

  afterAll(async () => {
    // the venue bookings, equipment requests and safety checks go with their event
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds);
    if (venueIds.length > 0) await admin.from("venues").delete().in("id", venueIds);
    if (equipmentId) await admin.from("equipment").delete().eq("id", equipmentId);
  });

  const must = <T>(result: { data: T; error: { message: string } | null }): T => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };

  /**
   * An event for 120 people on 15 Jun 2031, assigned to the coordinator, whose arrangements are complete: status
   * awaiting_arrangements, its own venue (holds 150) booked and approved, and 2 PA systems for it, reserved.
   * `booking` and `equipment` override the venue booking's and equipment request's status.
   */
  async function readyEvent(over: { booking?: string; equipment?: string } = {}) {
    const venue = must(
      await admin.from("venues").insert({ name: "IT-99 Riverside Hall", address: "1 Test Road", max_capacity: 150 }).select("id").single(),
    );
    venueIds.push(venue.id as string);
    const event = must(
      await admin
        .from("events")
        .insert({
          name: `IT-99-${Math.random().toString(36).slice(2, 8)}`,
          organiser_id: who.organiser.userId,
          assigned_coordinator_id: who.coordinator.userId,
          status: "awaiting_arrangements",
          is_draft: false,
          expected_attendance: 120,
          preferred_start_datetime: "2031-06-15T01:00:00+00:00",
          preferred_end_datetime: "2031-06-15T09:00:00+00:00",
        })
        .select("id")
        .single(),
    );
    const eventId = event.id as string;
    eventIds.push(eventId);
    const booking = must(
      await admin
        .from("venue_bookings")
        .insert({
          event_id: eventId,
          venue_id: venue.id,
          status: over.booking ?? "approved",
          event_start_datetime: "2031-06-15T01:00:00+00:00",
          event_end_datetime: "2031-06-15T09:00:00+00:00",
          snapshot_expected_attendance: 120,
        })
        .select("id")
        .single(),
    );
    must(
      await admin.from("equipment_reservations").insert({
        event_id: eventId,
        equipment_id: equipmentId,
        venue_booking_id: booking.id,
        quantity_requested: 2,
        status: over.equipment ?? "reserved",
        notes: "Either side of the stage",
        start_datetime: "2031-06-15T01:00:00+00:00",
        end_datetime: "2031-06-15T09:00:00+00:00",
      }),
    );
    return eventId;
  }

  const confirmAs = (actor: Actor, eventId: string) =>
    actor.client.rpc("change_event_status", { p_event_id: eventId, p_new_status: "confirmed" }).maybeSingle();

  const statusOf = async (eventId: string) => must(await admin.from("events").select("status").eq("id", eventId).single()).status;

  it("SCRUM-99/AC1 SCRUM-99/AC7 stops anyone moving an event to preparation before its safety check", async () => {
    const eventId = await readyEvent();

    const byCoordinator = await confirmAs(who.coordinator, eventId);
    const byServiceRole = await admin.from("events").update({ status: "confirmed" }).eq("id", eventId);

    expect(byCoordinator.error?.code).toBe("SC001");
    expect(byServiceRole.error?.code).toBe("SC001"); // the gate holds even where RLS does not apply
    expect(await statusOf(eventId)).toBe("awaiting_arrangements");
  });

  const decide = (actor: Actor, eventId: string, decision: string, reason: string | null = null) =>
    actor.client.rpc("record_safety_decision", { p_event_id: eventId, p_decision: decision, p_reason: reason }).single();

  it("SCRUM-99/AC5 lets the coordinator move a Safety Approved event to preparation", async () => {
    const eventId = await readyEvent();

    const approval = await decide(who.safetyOfficer, eventId, "approved");
    const confirm = await confirmAs(who.coordinator, eventId);

    expect(approval.error).toBeNull();
    expect(confirm.error).toBeNull();
    expect(await statusOf(eventId)).toBe("confirmed");
  });

  it("SCRUM-99/AC4 refuses a decision from anyone but a Safety Officer, so the coordinator can't approve their own event", async () => {
    const eventId = await readyEvent();

    const byCoordinator = await decide(who.coordinator, eventId, "approved");
    const confirm = await confirmAs(who.coordinator, eventId);

    expect(byCoordinator.error?.code).toBe("42501");
    expect(confirm.error?.code).toBe("SC001");
  });

  /** The ids of these fixture events that are in the Safety Officer's queue (seeded events may be in it too). */
  const inQueue = async (actor: Actor, ids: string[]) => {
    const { data, error } = await actor.client.rpc("safety_check_queue");
    if (error) throw new Error(error.message);
    return (data as { id: string }[]).map((row) => row.id).filter((id) => ids.includes(id));
  };

  it("SCRUM-99/AC1 SCRUM-99/AC2 lists an event once its venue and technical arrangements are complete, and not before", async () => {
    const ready = await readyEvent();
    const venuePending = await readyEvent({ booking: "requested" });
    const equipmentPending = await readyEvent({ equipment: "requested" });

    expect(await inQueue(who.safetyOfficer, [ready, venuePending, equipmentPending])).toEqual([ready]);
  });

  it("SCRUM-99/AC2 refuses the queue to anyone but a Safety Officer", async () => {
    const { error } = await who.coordinator.client.rpc("safety_check_queue");

    expect(error?.code).toBe("42501");
  });

  it("SCRUM-99/AC6 refuses a rejection without a reason, and a rejected event cannot proceed to preparation", async () => {
    const eventId = await readyEvent();

    const noReason = await decide(who.safetyOfficer, eventId, "rejected", "  ");
    const rejected = await decide(who.safetyOfficer, eventId, "rejected", "Fire exit blocked by the stage");
    const confirm = await confirmAs(who.coordinator, eventId);

    expect(noReason.error?.code).toBe("23514"); // check_violation: the safety_checks reason rule
    expect(rejected.error).toBeNull();
    expect(confirm.error?.code).toBe("SC001");
    expect(await statusOf(eventId)).toBe("awaiting_arrangements");
  });

  it("SCRUM-99/AC1 refuses a decision on an event that isn't waiting for a safety check", async () => {
    const venuePending = await readyEvent({ booking: "requested" });
    const alreadyApproved = await readyEvent();
    expect((await decide(who.safetyOfficer, alreadyApproved, "approved")).error).toBeNull();

    const early = await decide(who.safetyOfficer, venuePending, "approved");
    const again = await decide(who.safetyOfficer, alreadyApproved, "rejected", "Second thoughts");

    expect(early.error?.code).toBe("SC002");
    expect(again.error?.code).toBe("SC002");
  });

  it("SCRUM-99/AC8 records the Safety Officer, the decision, the date and time, and the comment", async () => {
    const eventId = await readyEvent();
    const before = Date.now();

    const { data: returned, error } = await decide(who.safetyOfficer, eventId, "approved", "  Exits clear, PA well placed ");
    const stored = must(await admin.from("safety_checks").select("*").eq("event_id", eventId).single());

    expect(error).toBeNull();
    expect(stored).toMatchObject({
      decided_by: who.safetyOfficer.userId, // from the caller's login, not from anything they sent
      decision: "approved",
      reason: "Exits clear, PA well placed",
    });
    expect(Date.parse(stored.decided_at as string)).toBeGreaterThanOrEqual(before - 5000); // the database's clock
    expect(returned).toMatchObject({ id: stored.id, officer_name: "Farah Ismail", decided_at: stored.decided_at });
  });

  it("SCRUM-99/AC3 gives the Safety Officer the information needed for the safety check", async () => {
    const eventId = await readyEvent();
    const theatre = must(await admin.from("room_layouts").select("id").eq("name", "Theatre").single());
    const { venue_id: venueId } = must(await admin.from("venue_bookings").select("venue_id").eq("event_id", eventId).single());
    must(
      await admin
        .from("venues")
        .update({ emergency_access: "Two fire exits on the east wall", restrictions: "No open flames", accessibility_notes: "Step-free entrance" })
        .eq("id", venueId),
    );
    must(await admin.from("venue_supported_layouts").insert({ venue_id: venueId, room_layout_id: theatre.id, max_capacity_for_layout: 130 }));
    must(await admin.from("venue_unavailability").insert({
      venue_id: venueId,
      reason: "maintenance",
      notes: "East lift out of service",
      start_datetime: "2031-06-14T00:00:00+00:00",
      end_datetime: "2031-06-16T00:00:00+00:00",
    }));
    must(
      await admin
        .from("events")
        .update({ preferred_room_layout_id: theatre.id, accessibility_requirements: "Two wheelchair spaces near the stage" })
        .eq("id", eventId),
    );

    const { data, error } = await who.safetyOfficer.client.rpc("safety_check_details", { p_event_id: eventId });

    expect(error).toBeNull();
    expect(data).toMatchObject({
      id: eventId,
      expected_attendance: 120, // Expected attendance
      layout: "Theatre",
      accessibility_requirements: "Two wheelchair spaces near the stage", // Accessibility requirements
      venues: [
        {
          name: "IT-99 Riverside Hall",
          max_capacity: 150, // Venue capacity
          layout_capacity: 130, // and layout
          emergency_access: "Two fire exits on the east wall", // Emergency access
          accessibility_notes: "Step-free entrance",
          restrictions: "No open flames", // Known venue restrictions
          unavailability: [{ reason: "maintenance", notes: "East lift out of service" }],
        },
      ],
      equipment: [{ name: "IT-99 PA System", quantity: 2, placement: "Either side of the stage" }], // Equipment placement
      decisions: [],
    });
  });

  it("SCRUM-99/AC3 keeps the safety information from anyone but a Safety Officer", async () => {
    const eventId = await readyEvent();

    const { data, error } = await who.organiser.client.rpc("safety_check_details", { p_event_id: eventId });

    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });

  // The route reads what PostgREST really sends (record_safety_decision() returns a table, so a one-row array); the unit
  // tests' fake once sent an object, and the page crashed on the missing decided_at.
  it("SCRUM-99/AC5 SCRUM-99/AC8 POST /safety-checks/:id/decision returns the saved decision the page shows", async () => {
    const eventId = await readyEvent();
    const app = createApp(createSupabaseDeps());

    const res = await request(app)
      .post(`/safety-checks/${eventId}/decision`)
      .set("Cookie", `cs_session=${who.safetyOfficer.token}`)
      .send({ decision: "approved", reason: "Exits clear" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ decision: "approved", reason: "Exits clear", officer_name: "Farah Ismail", label: "Safety Approved" });
    expect(Number.isNaN(Date.parse(res.body.decided_at))).toBe(false);
  });
});
