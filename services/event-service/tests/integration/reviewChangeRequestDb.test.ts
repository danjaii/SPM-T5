import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-67 against Postgres (migration 42): review_change_request() approves a change request by saving it through
 * update_event_details() in the same transaction (change history, SCRUM-113's send-back), or rejects it with a reason, only
 * for the event's current coordinator and only once. docs/specs/review-change-request.md. Fixtures are made with the secret
 * key, named "IT-67-", dated 2031 and removed afterwards.
 */

const EMAILS = {
  coordinator: "rachel.tan@connectsphere.example.com",
  otherCoordinator: "marcus.lim@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
};

type Row = Record<string, unknown>;
const RAISE = { expected_attendance: { from: 120, to: 150 } };

describe.skipIf(!hasDb)("SCRUM-67 review a change request (migration 42)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];
  const venueIds: string[] = [];

  beforeAll(async () => {
    for (const [key, email] of Object.entries(EMAILS)) who[key as keyof typeof EMAILS] = await signInAs(email);
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds);
    if (venueIds.length > 0) await admin.from("venues").delete().in("id", venueIds);
  });

  async function insert(table: string, row: Row): Promise<string> {
    const { data, error } = await admin.from(table).insert(row).select("id").single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data.id as string;
  }

  /** An event for 120 people on 3 Mar 2031, assigned to Rachel, with a pending request to raise it to 150. */
  async function eventWithRequest(status = "planning", proposed: Row = RAISE) {
    const eventId = await insert("events", {
      name: `IT-67-${Math.random().toString(36).slice(2, 8)}`,
      organiser_id: who.organiser.userId,
      assigned_coordinator_id: who.coordinator.userId,
      status,
      is_draft: false,
      expected_attendance: 120,
      preferred_start_datetime: "2031-03-03T01:00:00+00:00",
      preferred_end_datetime: "2031-03-03T09:00:00+00:00",
    });
    eventIds.push(eventId);
    const requestId = await insert("event_change_requests", {
      event_id: eventId,
      requested_by: who.organiser.userId,
      change_description: "Changed: expected attendance",
      proposed_changes: proposed,
      status: "pending",
    });
    return { eventId, requestId };
  }

  const review = (actor: Actor, requestId: string, args: Row) =>
    actor.client.rpc("review_change_request", { p_request_id: requestId, ...args });
  const approve = (actor: Actor, requestId: string, changes: Row = RAISE, sendBack?: Row) =>
    review(actor, requestId, { p_approve: true, p_changes: changes, ...(sendBack ? { p_send_back: sendBack } : {}) });
  const reject = (actor: Actor, requestId: string, reason: string) => review(actor, requestId, { p_approve: false, p_reason: reason });

  const requestRow = async (id: string) => (await admin.from("event_change_requests").select("*").eq("id", id).single()).data as Row;
  const eventRow = async (id: string) => (await admin.from("events").select("*").eq("id", id).single()).data as Row;

  // ----------------------------------------------------------------------------
  // AC3 approving applies it
  // ----------------------------------------------------------------------------

  it("67-S3: approving saves the requested values, records them as the coordinator's change, and marks the request approved", async () => {
    const { eventId, requestId } = await eventWithRequest();

    const { error } = await approve(who.coordinator, requestId);

    expect(error).toBeNull();
    expect((await eventRow(eventId)).expected_attendance).toBe(150);
    const request = await requestRow(requestId);
    expect(request).toMatchObject({ status: "approved", reviewed_by: who.coordinator.userId });
    expect(request.reviewed_at).not.toBeNull();
    const history = (await admin.from("event_change_history").select("changed_by, changes, is_important").eq("event_id", eventId)).data;
    expect(history).toEqual([{ changed_by: who.coordinator.userId, changes: RAISE, is_important: true }]);
  });

  it("67-S4: approving with the affected arrangements sends them back for review (SCRUM-113)", async () => {
    const { eventId, requestId } = await eventWithRequest("confirmed");
    const venueId = await insert("venues", { name: "IT-67 Hall", address: "1 Test Road", max_capacity: 130 });
    venueIds.push(venueId);
    const bookingId = await insert("venue_bookings", {
      event_id: eventId, venue_id: venueId, status: "approved",
      event_start_datetime: "2031-03-03T01:00:00+00:00", event_end_datetime: "2031-03-03T09:00:00+00:00",
    });

    await approve(who.coordinator, requestId, RAISE, { venue_bookings: [bookingId], equipment_requests: [] });

    expect((await admin.from("venue_bookings").select("status").eq("id", bookingId).single()).data).toEqual({ status: "requested" });
    expect((await eventRow(eventId)).status).toBe("planning");
  });

  it("67-S5: an event changed since the request is not overwritten (CS111); the request stays pending", async () => {
    const { eventId, requestId } = await eventWithRequest();
    await admin.from("events").update({ expected_attendance: 130 }).eq("id", eventId);

    expect((await approve(who.coordinator, requestId)).error?.code).toBe("CS111");
    expect((await eventRow(eventId)).expected_attendance).toBe(130);
    expect((await requestRow(requestId)).status).toBe("pending");
  });

  it("67-S5: only the request's own values can be applied, all of them (22023)", async () => {
    const { requestId } = await eventWithRequest("planning", {
      expected_attendance: { from: 120, to: 150 },
      equipment_requirements_notes: { from: null, to: "Two projectors" },
    });

    expect((await approve(who.coordinator, requestId, { expected_attendance: { from: 120, to: 999 } })).error?.code).toBe("22023");
    expect((await approve(who.coordinator, requestId, RAISE)).error?.code).toBe("22023");
    expect((await requestRow(requestId)).status).toBe("pending");
  });

  it("67-S5: a seeded request holding only the new value can be approved as that value", async () => {
    const { eventId, requestId } = await eventWithRequest("planning", { expected_attendance: 220 });

    expect((await approve(who.coordinator, requestId, { expected_attendance: { from: 120, to: 220 } })).error).toBeNull();
    expect((await eventRow(eventId)).expected_attendance).toBe(220);
  });

  it("67-S11: a completed event's request cannot be approved (CS112)", async () => {
    const { requestId } = await eventWithRequest("completed");

    expect((await approve(who.coordinator, requestId)).error?.code).toBe("CS112");
    expect((await requestRow(requestId)).status).toBe("pending");
  });

  // ----------------------------------------------------------------------------
  // AC4, AC5 rejecting
  // ----------------------------------------------------------------------------

  it("67-S7: rejecting with a reason marks it rejected and leaves the event as it is", async () => {
    const { eventId, requestId } = await eventWithRequest();

    expect((await reject(who.coordinator, requestId, "  The hall cannot hold 150  ")).error).toBeNull();

    expect(await requestRow(requestId)).toMatchObject({
      status: "rejected",
      review_notes: "The hall cannot hold 150",
      reviewed_by: who.coordinator.userId,
    });
    expect((await eventRow(eventId)).expected_attendance).toBe(120);
  });

  it("67-S6: rejecting needs a reason (22023)", async () => {
    const { requestId } = await eventWithRequest();

    expect((await reject(who.coordinator, requestId, "   ")).error?.code).toBe("22023");
    expect((await requestRow(requestId)).status).toBe("pending");
  });

  // ----------------------------------------------------------------------------
  // AC7, AC8 who, and only once
  // ----------------------------------------------------------------------------

  it("67-S9: another coordinator or the organiser is refused (42501), and nothing changes", async () => {
    const { eventId, requestId } = await eventWithRequest();

    for (const actor of [who.otherCoordinator, who.organiser]) {
      expect((await approve(actor, requestId)).error?.code).toBe("42501");
      expect((await reject(actor, requestId, "No")).error?.code).toBe("42501");
    }
    expect((await requestRow(requestId)).status).toBe("pending");
    expect((await eventRow(eventId)).expected_attendance).toBe(120);
  });

  it("67-S10: a request already decided cannot be decided again (CS067)", async () => {
    const { requestId } = await eventWithRequest();
    await approve(who.coordinator, requestId);

    expect((await approve(who.coordinator, requestId)).error?.code).toBe("CS067");
    expect((await reject(who.coordinator, requestId, "Changed my mind")).error?.code).toBe("CS067");
    expect((await requestRow(requestId)).status).toBe("approved");
  });

  it("67-S9: nobody can update a request directly", async () => {
    const { requestId } = await eventWithRequest();

    await who.coordinator.client.from("event_change_requests").update({ status: "approved" }).eq("id", requestId);

    expect((await requestRow(requestId)).status).toBe("pending");
  });
});
