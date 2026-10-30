import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-174 against Postgres (docs/specs/cancel-event.md): cancelling an event needs a reason and is recorded, and its
 * venue bookings, equipment, technician assignments and pending change requests are released in the same transaction,
 * with the organiser and active attendees told why. Fixtures are made with the secret key, named "IT-174-", dated 2031
 * and removed afterwards; every check reads only rows this file made (CLAUDE.md, SCRUM-143).
 */

const EMAILS = {
  coordinator: "rachel.tan@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
};

type Row = Record<string, unknown>;

describe.skipIf(!hasDb)("SCRUM-174 cancel an event (migrations 60 to 64)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];

  beforeAll(async () => {
    for (const [key, email] of Object.entries(EMAILS)) who[key as keyof typeof EMAILS] = await signInAs(email);
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds);
  });

  /** A Planning event on 3 Mar 2031, organised by Jason and assigned to Rachel. */
  async function planningEvent(status = "planning"): Promise<string> {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-174-${Math.random().toString(36).slice(2, 8)}`,
        organiser_id: who.organiser.userId,
        assigned_coordinator_id: who.coordinator.userId,
        status,
        is_draft: false,
        expected_attendance: 120,
        preferred_start_datetime: "2031-03-03T01:00:00+00:00",
        preferred_end_datetime: "2031-03-03T09:00:00+00:00",
      })
      .select("id")
      .single();
    if (error) throw new Error(`events: ${error.message}`);
    eventIds.push(data.id as string);
    return data.id as string;
  }

  /** What the status panel does: change_event_status() as the signed-in coordinator. */
  const changeStatus = (actor: Actor, eventId: string, status: string, reason: string | null) =>
    actor.client.rpc("change_event_status", { p_event_id: eventId, p_new_status: status, p_reason: reason }).maybeSingle();

  const eventRow = async (id: string) => (await admin.from("events").select("*").eq("id", id).single()).data as Row;
  const history = async (id: string) =>
    ((await admin.from("event_status_history").select("old_status, new_status, changed_by, reason").eq("event_id", id)).data ?? []) as Row[];

  // ----------------------------------------------------------------------------
  // AC1, AC2 a reason, recorded
  // ----------------------------------------------------------------------------

  it.each([null, "", "   "])("174-S1 SCRUM-174/AC1 refuses a cancellation with no reason (%j); the event and its history are unchanged", async (reason) => {
    const eventId = await planningEvent();

    const { error } = await changeStatus(who.coordinator, eventId, "cancelled", reason);

    expect(error?.code).toBe("22023");
    expect((await eventRow(eventId)).status).toBe("planning");
    expect(await history(eventId)).toEqual([]);
  });

  it("174-S2 SCRUM-174/AC2 cancels the event with a reason: Cancelled, stamped, and the reason in its status history", async () => {
    const eventId = await planningEvent();

    const { error } = await changeStatus(who.coordinator, eventId, "cancelled", "Organiser withdrew the event");

    expect(error).toBeNull();
    const event = await eventRow(eventId);
    expect(event.status).toBe("cancelled");
    expect(event.cancelled_at).not.toBeNull();
    expect(await history(eventId)).toEqual([
      { old_status: "planning", new_status: "cancelled", changed_by: who.coordinator.userId, reason: "Organiser withdrew the event" },
    ]);
  });
});
