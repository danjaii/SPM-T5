import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-101: venues.setup_minutes / turnaround_minutes and set_venue_timing (migration 26). Signs in as seeded
 * users so the grants and the function's role check are exercised for real. Fixtures are prefixed "IT-".
 */
const STAFF = "kenneth.wong@connectsphere.example.com";
const COORDINATOR = "rachel.tan@connectsphere.example.com";
const DENIED = "42501";

describe.skipIf(!hasDb)("SCRUM-101 venue setup and turnaround times (migration 26)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  let staff: { client: SupabaseClient; userId: string };
  let coordinator: { client: SupabaseClient; userId: string };

  beforeAll(async () => {
    staff = await signInAs(STAFF);
    coordinator = await signInAs(COORDINATOR);
  });
  afterAll(async () => {
    await fixtures.cleanup();
  });

  const timesOf = async (venueId: string) => {
    const { data } = await admin.from("venues").select("setup_minutes, turnaround_minutes").eq("id", venueId).single();
    return data;
  };

  it("101-S2: a new venue has setup and turnaround of 0", async () => {
    const venue = await fixtures.venue("IT-timing");
    expect(await timesOf(venue)).toEqual({ setup_minutes: 0, turnaround_minutes: 0 });
  });

  it("101-S1: venue staff save the times with set_venue_timing, and the change is logged", async () => {
    const venue = await fixtures.venue("IT-timing");

    const { error } = await staff.client.rpc("set_venue_timing", { p_venue_id: venue, p_setup: 30, p_turnaround: 45 });

    expect(error).toBeNull();
    expect(await timesOf(venue)).toEqual({ setup_minutes: 30, turnaround_minutes: 45 });
    const { data: log } = await admin.from("activity_log").select("actor_id, action_type").eq("entity_id", venue);
    expect(log).toEqual([{ actor_id: staff.userId, action_type: "venue_timing_set" }]);
    await admin.from("activity_log").delete().eq("entity_id", venue);
  });

  it("101-S4: a coordinator cannot call set_venue_timing", async () => {
    const venue = await fixtures.venue("IT-timing");

    const { error } = await coordinator.client.rpc("set_venue_timing", { p_venue_id: venue, p_setup: 10, p_turnaround: 10 });

    expect(error?.code).toBe(DENIED);
    expect(await timesOf(venue)).toEqual({ setup_minutes: 0, turnaround_minutes: 0 });
  });

  it("101-S4: nobody can write the columns directly, not even venue staff", async () => {
    const venue = await fixtures.venue("IT-timing");

    for (const actor of [staff, coordinator]) {
      const { error } = await actor.client.from("venues").update({ setup_minutes: 99 }).eq("id", venue);
      expect(error?.code).toBe(DENIED);
    }
    expect(await timesOf(venue)).toEqual({ setup_minutes: 0, turnaround_minutes: 0 });
  });

  it("101-S3: the database refuses negative and out-of-range minutes, keeping the old values", async () => {
    const venue = await fixtures.venue("IT-timing");
    await staff.client.rpc("set_venue_timing", { p_venue_id: venue, p_setup: 30, p_turnaround: 45 });

    for (const [setup, turnaround] of [[-15, 45], [30, -1], [1441, 0]]) {
      const { error } = await staff.client.rpc("set_venue_timing", { p_venue_id: venue, p_setup: setup, p_turnaround: turnaround });
      expect(error?.code).toBe("23514"); // check_violation
    }
    expect(await timesOf(venue)).toEqual({ setup_minutes: 30, turnaround_minutes: 45 });
    await admin.from("activity_log").delete().eq("entity_id", venue);
  });

  it("101-S1: venue staff can still edit the other venue columns", async () => {
    const venue = await fixtures.venue("IT-timing");
    const { error } = await staff.client.from("venues").update({ description: "updated" }).eq("id", venue);
    expect(error).toBeNull();
  });
});
