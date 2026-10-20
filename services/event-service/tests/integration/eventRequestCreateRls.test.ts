import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-49/AC1,AC7: create_event_request() is security invoker, so an organiser can only create
 * a request if RLS lets them insert into events and event_status_history. Every check signs in as
 * a seeded user. Fixtures are prefixed "IT-" and removed afterwards.
 */
const EMAILS = {
  organiser: "jason.chua@techconnect.example.com",
  otherOrganiser: "weiling.ong@techconnect.example.com",
  coordinator: "rachel.tan@connectsphere.example.com",
  attendee: "alicia.fernandez@example.com",
};

/** Postgres "insufficient_privilege": an RLS policy denied the write. */
const DENIED = "42501";

describe.skipIf(!hasDb)("SCRUM-49/AC1,AC7 create_event_request row level security", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];

  const params = (name: string) => ({
    p_name: name,
    p_purpose: "Integration test",
    p_description: "Created by eventRequestCreateRls.test.ts",
    p_preferred_start_datetime: "2031-05-01T09:00:00Z",
    p_preferred_end_datetime: "2031-05-01T17:00:00Z",
    p_expected_attendance: 40,
    p_venue_requirements: "Projector",
    p_preferred_room_layout_id: null,
    p_accessibility_requirements: null,
    p_equipment_requirements_notes: null,
    p_registration_required: false,
  });

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Array<keyof typeof EMAILS>) who[key] = await signInAs(EMAILS[key]);
  });

  afterAll(async () => {
    if (eventIds.length === 0) return;
    await admin.from("event_status_history").delete().in("event_id", eventIds);
    await admin.from("events").delete().in("id", eventIds);
  });

  it("lets an event organiser create a submitted request owned by them, with its history row", async () => {
    const { data, error } = await who.organiser.client.rpc("create_event_request", params("IT-organiser-request"));
    expect(error).toBeNull();
    eventIds.push(data.id);
    expect(data).toMatchObject({ status: "submitted", is_draft: false, organiser_id: who.organiser.userId });

    const { data: history } = await admin.from("event_status_history").select("*").eq("event_id", data.id);
    expect(history).toHaveLength(1);
    expect(history![0]).toMatchObject({ old_status: null, new_status: "submitted", changed_by: who.organiser.userId });
  });

  it.each(["coordinator", "attendee"] as const)("refuses a %s and creates nothing", async (role) => {
    const name = `IT-${role}-request`;
    const { error } = await who[role].client.rpc("create_event_request", params(name));
    expect(error?.code).toBe(DENIED);
    const { data } = await admin.from("events").select("id").eq("name", name);
    expect(data).toHaveLength(0);
  });

  it("refuses a direct insert that names a different organiser", async () => {
    const { error } = await who.organiser.client.from("events").insert({
      name: "IT-spoofed-organiser",
      organiser_id: who.otherOrganiser.userId,
      status: "submitted",
      is_draft: false,
      expected_attendance: 10,
    });
    expect(error?.code).toBe(DENIED);
  });

  it("refuses a status history row written by the organiser for someone else's event", async () => {
    const { data: other } = await admin
      .from("events")
      .insert({ name: "IT-other-organiser-event", organiser_id: who.otherOrganiser.userId, status: "submitted", is_draft: false, expected_attendance: 10 })
      .select("id")
      .single();
    eventIds.push(other!.id);
    const { error } = await who.organiser.client
      .from("event_status_history")
      .insert({ event_id: other!.id, old_status: null, new_status: "submitted", changed_by: who.organiser.userId });
    expect(error?.code).toBe(DENIED);
  });
});
