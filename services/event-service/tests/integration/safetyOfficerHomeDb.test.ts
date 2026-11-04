import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-165 against Postgres: safety_officer_home() (migration 75) behind the Safety Officer Home. Fixtures are made with
 * the secret key, named "IT-165-", dated 2031 and removed afterwards. Other test files share this database, so each check
 * is on the rows this file made, never on a whole-table count.
 */
describe.skipIf(!hasDb)("SCRUM-165 Safety Officer Home (database)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  let safetyOfficer: Actor;
  let coordinator: Actor;
  let organiser: Actor;
  const eventIds: string[] = [];
  const venueIds: string[] = [];

  beforeAll(async () => {
    safetyOfficer = await signInAs("farah.ismail@connectsphere.example.com");
    coordinator = await signInAs("rachel.tan@connectsphere.example.com");
    organiser = await signInAs("jason.chua@techconnect.example.com");
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds);
    if (venueIds.length > 0) await admin.from("venues").delete().in("id", venueIds);
  });

  const must = <T>(result: { data: T; error: { message: string } | null }): T => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };

  /** An event ready for its safety check: awaiting_arrangements with its own venue booked and approved. */
  async function readyEvent() {
    const venue = must(await admin.from("venues").insert({ name: "IT-165 Hall", address: "1 Test Road", max_capacity: 150 }).select("id").single());
    venueIds.push(venue.id as string);
    const event = must(
      await admin
        .from("events")
        .insert({
          name: `IT-165-${Math.random().toString(36).slice(2, 8)}`,
          organiser_id: organiser.userId,
          assigned_coordinator_id: coordinator.userId,
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
    must(
      await admin.from("venue_bookings").insert({
        event_id: eventId,
        venue_id: venue.id,
        status: "approved",
        event_start_datetime: "2031-06-15T01:00:00+00:00",
        event_end_datetime: "2031-06-15T09:00:00+00:00",
        snapshot_expected_attendance: 120,
      }),
    );
    return eventId;
  }

  const home = async () =>
    must(await safetyOfficer.client.rpc("safety_officer_home")) as {
      ready: { id: string; name: string; recheck: boolean; venue_names: string[] }[];
      waiting_on_coordinator: number;
      approved_this_month: number;
      recent: { event_id: string; decision: string }[];
    };

  it("SCRUM-165/AC1 lists a ready event with its venue, not yet marked for a re-check", async () => {
    const eventId = await readyEvent();

    const mine = (await home()).ready.find((e) => e.id === eventId);

    expect(mine).toMatchObject({ recheck: false, venue_names: ["IT-165 Hall"] });
  });

  it("SCRUM-165/AC2 marks an event back after Request Changes as a re-check", async () => {
    const eventId = await readyEvent();
    must(
      await safetyOfficer.client
        .rpc("record_safety_decision", { p_event_id: eventId, p_decision: "changes_requested", p_reason: "Move the stage" })
        .single(),
    );
    // the coordinator fixed it: the event is back with its arrangements complete
    must(await admin.from("events").update({ status: "awaiting_arrangements" }).eq("id", eventId).select("id").single());

    const result = await home();

    expect(result.ready.find((e) => e.id === eventId)).toMatchObject({ recheck: true });
    expect(result.recent.find((r) => r.event_id === eventId)).toMatchObject({ decision: "changes_requested" });
  });

  it("SCRUM-165/AC3 refuses anyone who is not a Safety Officer", async () => {
    const { error } = await coordinator.client.rpc("safety_officer_home");

    expect(error?.code).toBe("42501");
  });
});
