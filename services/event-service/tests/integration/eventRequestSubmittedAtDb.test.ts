import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-49/AC6: create_event_request() (migration 49) stamps the request with the time it was submitted, and returns it,
 * so the organiser's confirmation can show it. Called as a seeded organiser so RLS applies. Fixtures are prefixed "IT-"
 * and removed afterwards.
 */
const ORGANISER = "jason.chua@techconnect.example.com";

/** How far the database clock may be from this machine's clock, in ms (the test and the database share a host). */
const CLOCK_TOLERANCE_MS = 10_000;

describe.skipIf(!hasDb)("SCRUM-49/AC6 create_event_request stamps the submission time", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  let organiser: Actor;
  const eventIds: string[] = [];

  const params = (name: string) => ({
    p_name: name,
    p_purpose: "Integration test",
    p_description: "Created by eventRequestSubmittedAtDb.test.ts",
    p_preferred_start_datetime: "2031-05-02T09:00:00Z",
    p_preferred_end_datetime: "2031-05-02T17:00:00Z",
    p_expected_attendance: 40,
    p_venue_requirements: "Projector",
    p_preferred_room_layout_id: null,
    p_accessibility_requirements: "None required",
    p_equipment_requirements_notes: "None required",
    p_registration_required: false,
  });

  beforeAll(async () => {
    organiser = await signInAs(ORGANISER);
  });

  afterAll(async () => {
    if (eventIds.length === 0) return;
    await admin.from("event_status_history").delete().in("event_id", eventIds);
    await admin.from("events").delete().in("id", eventIds);
  });

  it("returns submitted_at as a recent timestamp that matches the stored row", async () => {
    const before = Date.now();
    const { data, error } = await organiser.client.rpc("create_event_request", params("IT-49-AC6-submitted-at"));
    const after = Date.now();
    expect(error).toBeNull();
    eventIds.push(data.id);

    expect(typeof data.submitted_at).toBe("string");
    const returned = new Date(data.submitted_at).getTime();
    expect(Number.isNaN(returned)).toBe(false);
    expect(returned).toBeGreaterThanOrEqual(before - CLOCK_TOLERANCE_MS);
    expect(returned).toBeLessThanOrEqual(after + CLOCK_TOLERANCE_MS);

    const { data: stored } = await admin.from("events").select("submitted_at").eq("id", data.id).single();
    expect(new Date(stored!.submitted_at).getTime()).toBe(returned);
  });
});
