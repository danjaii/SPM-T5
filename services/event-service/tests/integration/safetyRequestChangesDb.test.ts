import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-100 against Postgres: the Safety Officer requests changes to an event at its Operational Safety Check (SCRUM-99,
 * docs/specs/operational-safety-check.md). Fixtures are made with the secret key, named "IT-100-", dated 2031 and removed
 * afterwards.
 */
const EMAILS = {
  safetyOfficer: "farah.ismail@connectsphere.example.com",
  coordinator: "rachel.tan@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
  otherCoordinator: "marcus.lim@connectsphere.example.com",
  otherOrganiser: "weiling.ong@techconnect.example.com",
};

describe.skipIf(!hasDb)("SCRUM-100 Safety Officer requests changes (database)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];
  const venueIds: string[] = [];
  let equipmentId: string;

  beforeAll(async () => {
    for (const [key, email] of Object.entries(EMAILS)) who[key as keyof typeof EMAILS] = await signInAs(email);
    const equipment = await admin.from("equipment").insert({ name: "IT-100 PA System", total_quantity: 10 }).select("id").single();
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

  /**
   * An event for 120 people on 15 Jun 2031, assigned to the coordinator, ready for its safety check: status
   * awaiting_arrangements, its own venue (holds 150) booked and approved, and 2 PA systems for that booking, reserved.
   */
  async function readyEvent() {
    const venue = must(
      await admin.from("venues").insert({ name: "IT-100 Riverside Hall", address: "1 Test Road", max_capacity: 150 }).select("id").single(),
    );
    venueIds.push(venue.id as string);
    const event = must(
      await admin
        .from("events")
        .insert({
          name: `IT-100-${Math.random().toString(36).slice(2, 8)}`,
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
          status: "approved",
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
        status: "reserved",
        start_datetime: "2031-06-15T01:00:00+00:00",
        end_datetime: "2031-06-15T09:00:00+00:00",
      }),
    );
    return eventId;
  }

  const requestChanges = (actor: Actor, eventId: string, changes: string) =>
    actor.client
      .rpc("record_safety_decision", { p_event_id: eventId, p_decision: "changes_requested", p_reason: changes })
      .single();

  it("SCRUM-100/AC2 records the Safety Officer, the changes requested, and the date and time", async () => {
    const eventId = await readyEvent();
    const before = Date.now();

    const { error } = await requestChanges(who.safetyOfficer, eventId, "  Move the stage clear of fire exit B ");
    const stored = must(await admin.from("safety_checks").select("*").eq("event_id", eventId).single());

    expect(error).toBeNull();
    expect(stored).toMatchObject({
      decided_by: who.safetyOfficer.userId, // from the caller's login, not from anything they sent
      decision: "changes_requested",
      reason: "Move the stage clear of fire exit B",
    });
    expect(Date.parse(stored.decided_at as string)).toBeGreaterThanOrEqual(before - 5000); // the database's clock
  });

  const statusOf = async (eventId: string) => must(await admin.from("events").select("status").eq("id", eventId).single()).status;

  it("SCRUM-100/AC3 returns the event to Planning, recorded in its status history", async () => {
    const eventId = await readyEvent();

    const { error } = await requestChanges(who.safetyOfficer, eventId, "Move the stage clear of fire exit B");
    const history = must(
      await admin.from("event_status_history").select("old_status, new_status, changed_by, reason").eq("event_id", eventId),
    );

    expect(error).toBeNull();
    expect(await statusOf(eventId)).toBe("planning");
    expect(history).toEqual([
      {
        old_status: "awaiting_arrangements",
        new_status: "planning",
        changed_by: who.safetyOfficer.userId,
        reason: "Move the stage clear of fire exit B",
      },
    ]);
  });

  it("SCRUM-100/AC4 a changed venue booking goes back to Venue Staff, and its equipment to Technical Support, for review", async () => {
    const eventId = await readyEvent();
    must(await requestChanges(who.safetyOfficer, eventId, "Finish an hour earlier so the hall can be cleared safely"));
    const booking = must(await admin.from("venue_bookings").select("id").eq("event_id", eventId).single());

    const { error } = await who.coordinator.client.rpc("change_venue_booking", {
      p_booking_id: booking.id,
      p_start: "2031-06-15T01:00:00+00:00",
      p_end: "2031-06-15T08:00:00+00:00",
      p_expected_attendance: 120,
      p_venue_requirements: null,
    });
    const bookingAfter = must(await admin.from("venue_bookings").select("status").eq("id", booking.id).single());
    const equipmentAfter = must(await admin.from("equipment_reservations").select("status").eq("event_id", eventId).single());

    expect(error).toBeNull();
    expect(bookingAfter.status).toBe("requested"); // Pending: Venue Staff review it again
    expect(equipmentAfter.status).toBe("requested"); // Submitted: Technical Support review it again
  });

  const confirmAs = (actor: Actor, eventId: string) =>
    actor.client.rpc("change_event_status", { p_event_id: eventId, p_new_status: "confirmed" }).maybeSingle();

  it("SCRUM-100/AC5 stops the event moving to preparation while the requested changes are outstanding", async () => {
    const eventId = await readyEvent();
    must(await requestChanges(who.safetyOfficer, eventId, "Move the stage clear of fire exit B"));

    const confirm = await confirmAs(who.coordinator, eventId);

    expect(confirm.error?.code).toBe("SC001");
    expect(await statusOf(eventId)).toBe("planning");
  });

  const returnForReview = (actor: Actor, eventId: string) =>
    actor.client.rpc("change_event_status", { p_event_id: eventId, p_new_status: "awaiting_arrangements" }).maybeSingle();

  /** Whether this fixture event is in the Safety Officer's queue (seeded events may be in it too). */
  const inQueue = async (eventId: string) => {
    const queue = must(await who.safetyOfficer.client.rpc("safety_check_queue")) as { id: string }[];
    return queue.some((row) => row.id === eventId);
  };

  it("SCRUM-100/AC6 puts the event back in the safety check queue once the coordinator returns it for review", async () => {
    const eventId = await readyEvent();
    must(await requestChanges(who.safetyOfficer, eventId, "Move the stage clear of fire exit B"));

    must(await returnForReview(who.coordinator, eventId));

    expect(await inQueue(eventId)).toBe(true);
  });

  it("SCRUM-100/AC6 the returned event needs another safety check, and only once it is approved can it move to preparation", async () => {
    const eventId = await readyEvent();
    must(await requestChanges(who.safetyOfficer, eventId, "Move the stage clear of fire exit B"));
    must(await returnForReview(who.coordinator, eventId));

    const beforeSecondCheck = await confirmAs(who.coordinator, eventId);
    const secondCheck = await who.safetyOfficer.client
      .rpc("record_safety_decision", { p_event_id: eventId, p_decision: "approved", p_reason: null })
      .single();
    const afterSecondCheck = await confirmAs(who.coordinator, eventId);

    expect(beforeSecondCheck.error?.code).toBe("SC001");
    expect(secondCheck.error).toBeNull();
    expect(afterSecondCheck.error).toBeNull();
    expect(await statusOf(eventId)).toBe("confirmed");
  });

  const safetyDecisionsFor = (actor: Actor, eventId: string) =>
    actor.client.rpc("event_safety_decisions", { p_event_id: eventId });

  it("SCRUM-100/AC7 shows the event's coordinator and organiser the Safety Officer's requested changes", async () => {
    const eventId = await readyEvent();
    const saved = must(await requestChanges(who.safetyOfficer, eventId, "Move the stage clear of fire exit B")) as {
      decided_at: string;
    };
    const expected = [
      {
        decision: "changes_requested",
        reason: "Move the stage clear of fire exit B",
        officer_name: "Farah Ismail",
        decided_at: saved.decided_at,
        revoked_at: null,
      },
    ];

    expect(must(await safetyDecisionsFor(who.coordinator, eventId))).toEqual(expected);
    expect(must(await safetyDecisionsFor(who.organiser, eventId))).toEqual(expected);
  });

  it("SCRUM-100/AC7 keeps the requested changes from a coordinator or organiser not responsible for the event", async () => {
    const eventId = await readyEvent();
    must(await requestChanges(who.safetyOfficer, eventId, "Move the stage clear of fire exit B"));

    const byOtherCoordinator = await safetyDecisionsFor(who.otherCoordinator, eventId);
    const byOtherOrganiser = await safetyDecisionsFor(who.otherOrganiser, eventId);

    expect(byOtherCoordinator.error?.code).toBe("42501");
    expect(byOtherOrganiser.error?.code).toBe("42501");
  });

  it("SCRUM-100/AC8 shows the event's coordinator and organiser an approval, with the Safety Officer, date and time, and comments", async () => {
    const eventId = await readyEvent();
    const saved = must(
      await who.safetyOfficer.client
        .rpc("record_safety_decision", { p_event_id: eventId, p_decision: "approved", p_reason: "Exits clear, PA well placed" })
        .single(),
    ) as { decided_at: string };
    const expected = [
      { decision: "approved", reason: "Exits clear, PA well placed", officer_name: "Farah Ismail", decided_at: saved.decided_at, revoked_at: null },
    ];

    expect(must(await safetyDecisionsFor(who.coordinator, eventId))).toEqual(expected);
    expect(must(await safetyDecisionsFor(who.organiser, eventId))).toEqual(expected);
  });

  const approve = (eventId: string) =>
    who.safetyOfficer.client
      .rpc("record_safety_decision", { p_event_id: eventId, p_decision: "approved", p_reason: null })
      .single();

  /** The coordinator saves an edit through SCRUM-111's update_event_details() ({ field: { from, to } }). */
  const editAsCoordinator = (eventId: string, changes: Record<string, { from: unknown; to: unknown }>) =>
    who.coordinator.client.rpc("update_event_details", { p_event_id: eventId, p_changes: changes });

  it("SCRUM-100/AC9 an important change after Safety Approval stops the event moving to preparation", async () => {
    const eventId = await readyEvent();
    must(await approve(eventId));

    must(await editAsCoordinator(eventId, { expected_attendance: { from: 120, to: 100 } }));
    const confirm = await confirmAs(who.coordinator, eventId);

    expect(confirm.error?.code).toBe("SC001");
    expect(await statusOf(eventId)).toBe("awaiting_arrangements");
  });

  it("SCRUM-100/AC9 after an important change the approved event is back in the safety check queue", async () => {
    const eventId = await readyEvent();
    must(await approve(eventId));
    expect(await inQueue(eventId)).toBe(false);

    must(await editAsCoordinator(eventId, { expected_attendance: { from: 120, to: 100 } }));

    expect(await inQueue(eventId)).toBe(true);
  });

  it("SCRUM-100/AC9 an ordinary change (the event's name) keeps the Safety Approval", async () => {
    const eventId = await readyEvent();
    must(await approve(eventId));
    const { name } = must(await admin.from("events").select("name").eq("id", eventId).single());

    must(await editAsCoordinator(eventId, { name: { from: name, to: `${name} (renamed)` } }));
    const confirm = await confirmAs(who.coordinator, eventId);

    expect(confirm.error).toBeNull();
    expect(await statusOf(eventId)).toBe("confirmed");
  });

  it("SCRUM-100/AC9 an important change to an event already in preparation sends it back for another safety check", async () => {
    const eventId = await readyEvent();
    must(await approve(eventId));
    must(await confirmAs(who.coordinator, eventId));

    must(await editAsCoordinator(eventId, { expected_attendance: { from: 120, to: 100 } }));
    const history = must(
      await admin.from("event_status_history").select("old_status, new_status").eq("event_id", eventId).eq("old_status", "confirmed"),
    );

    expect(await statusOf(eventId)).toBe("awaiting_arrangements");
    expect(history).toEqual([{ old_status: "confirmed", new_status: "awaiting_arrangements" }]);
    expect(await inQueue(eventId)).toBe(true);
  });

  it("SCRUM-100/AC9 the Safety Officer sees that the earlier approval no longer applies", async () => {
    const eventId = await readyEvent();
    must(await approve(eventId));

    must(await editAsCoordinator(eventId, { expected_attendance: { from: 120, to: 100 } }));
    const details = must(await who.safetyOfficer.client.rpc("safety_check_details", { p_event_id: eventId })) as {
      decisions: { decision: string; revoked_at: string | null }[];
    };

    expect(details.decisions).toHaveLength(1);
    expect(details.decisions[0].decision).toBe("approved");
    expect(details.decisions[0].revoked_at).toEqual(expect.any(String)); // when it stopped applying
  });

  it("SCRUM-100/AC9 the coordinator and organiser see that the earlier approval no longer applies", async () => {
    const eventId = await readyEvent();
    must(await approve(eventId));

    must(await editAsCoordinator(eventId, { expected_attendance: { from: 120, to: 100 } }));
    const decisions = must(await safetyDecisionsFor(who.coordinator, eventId)) as { decision: string; revoked_at?: string | null }[];

    expect(decisions).toHaveLength(1);
    expect(decisions[0].decision).toBe("approved");
    expect(decisions[0].revoked_at).toEqual(expect.any(String));
  });
});
