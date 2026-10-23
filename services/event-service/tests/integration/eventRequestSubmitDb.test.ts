import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-49/AC4: create_event_request() (migration 49) submits the request: status submitted, one status history row, no
 * coordinator, so it waits in the Event Coordinator Lead's unassigned queue (SCRUM-77: lead_unassigned_queue(),
 * migration 21). Called as a seeded organiser so RLS applies; the queue is read as a seeded Lead. Fixtures are prefixed
 * "IT-" and removed afterwards. The seeded events are in the queue too, so the queue check only looks at this suite's own
 * request.
 */
const EMAILS = {
  organiser: "jason.chua@techconnect.example.com",
  lead: "helen.ong@connectsphere.example.com",
};

describe.skipIf(!hasDb)("SCRUM-49/AC4 create_event_request submits into the Lead's unassigned queue", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];
  let created: Record<string, unknown> & { id: string };

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Array<keyof typeof EMAILS>) who[key] = await signInAs(EMAILS[key]);
    const { data, error } = await who.organiser.client.rpc("create_event_request", {
      p_name: "IT-49-AC4-submit",
      p_purpose: "Integration test",
      p_description: "Created by eventRequestSubmitDb.test.ts",
      p_preferred_start_datetime: "2031-05-03T09:00:00Z",
      p_preferred_end_datetime: "2031-05-03T17:00:00Z",
      p_expected_attendance: 40,
      p_venue_requirements: "Projector",
      p_preferred_room_layout_id: null,
      p_accessibility_requirements: "None required",
      p_equipment_requirements_notes: "None required",
      p_registration_required: false,
    });
    if (error) throw new Error(error.message);
    created = data;
    eventIds.push(data.id);
  });

  afterAll(async () => {
    if (eventIds.length === 0) return;
    await admin.from("event_status_history").delete().in("event_id", eventIds);
    await admin.from("events").delete().in("id", eventIds);
  });

  it("stores the request as submitted, not as a draft", async () => {
    const { data: stored } = await admin.from("events").select("status, is_draft").eq("id", created.id).single();
    expect(stored).toEqual({ status: "submitted", is_draft: false });
  });

  it("writes one status history row, from nothing to submitted, by the organiser", async () => {
    const { data: history } = await admin.from("event_status_history").select("*").eq("event_id", created.id);
    expect(history).toHaveLength(1);
    expect(history![0]).toMatchObject({ old_status: null, new_status: "submitted", changed_by: who.organiser.userId });
  });

  it("assigns no coordinator", async () => {
    const { data: stored } = await admin.from("events").select("assigned_coordinator_id").eq("id", created.id).single();
    expect(stored!.assigned_coordinator_id).toBeNull();
    expect(created.assigned_coordinator_id).toBeNull();
  });

  it("appears in the Lead's unassigned queue (SCRUM-77), with its organiser and submission time", async () => {
    const { data, error } = await who.lead.client.rpc("lead_unassigned_queue");
    expect(error).toBeNull();
    const row = (data as Array<Record<string, unknown>>).find((r) => r.id === created.id);
    expect(row).toMatchObject({ name: "IT-49-AC4-submit", organiser_name: "Jason Chua", expected_attendance: 40 });
    expect(new Date(row!.submitted_at as string).getTime()).toBe(new Date(created.submitted_at as string).getTime());
  });
});
