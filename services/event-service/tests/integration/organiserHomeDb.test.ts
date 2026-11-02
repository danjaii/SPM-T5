import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createSupabaseDeps } from "../../src/supabase";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-159: GET /events/my-requests/home against the real database (organiser_home(), migration 76), as the signed-in user.
 * Fixtures are made with the secret key, named "IT-159-" and removed afterwards. The seeded organisers have other events too,
 * so these tests only look at their own fixtures.
 */
const EMAILS = {
  organiserA: "jason.chua@techconnect.example.com",
  organiserB: "weiling.ong@techconnect.example.com",
  coordinator: "rachel.tan@connectsphere.example.com",
  attendee: "alicia.fernandez@example.com",
};

describe.skipIf(!hasDb)("SCRUM-159 organiser home (GET /events/my-requests/home)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const app = hasDb ? createApp(createSupabaseDeps()) : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];
  const ids = {} as Record<string, string>;

  async function newEvent(key: string, organiser: Actor, fields: Record<string, unknown> = {}) {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-159-${key}`,
        organiser_id: organiser.userId,
        status: "submitted",
        is_draft: false,
        preferred_start_datetime: "2031-06-15T01:00:00Z",
        preferred_end_datetime: "2031-06-15T09:00:00Z",
        expected_attendance: 80,
        submitted_at: "2031-01-01T00:00:00Z",
        ...fields,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(data.id as string);
    ids[key] = data.id as string;
  }

  const homeAs = (actor: Actor) => request(app).get("/events/my-requests/home").set("Cookie", `cs_session=${actor.token}`);
  const find = (body: Array<{ id: string }>, key: string) => body.find((e) => e.id === ids[key]) as Record<string, any> | undefined;

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Array<keyof typeof EMAILS>) who[key] = await signInAs(EMAILS[key]);
    await newEvent("plain", who.organiserA);
    await newEvent("other", who.organiserB);
    await newEvent("coordinated", who.organiserA, { assigned_coordinator_id: who.coordinator.userId, status: "planning" });
    await newEvent("asked", who.organiserA, { assigned_coordinator_id: who.coordinator.userId, status: "planning" });
    await newEvent("answered", who.organiserA, { assigned_coordinator_id: who.coordinator.userId, status: "planning" });
    await newEvent("changed", who.organiserA, { assigned_coordinator_id: who.coordinator.userId, status: "confirmed" });

    // a clarification request nobody answered, and one the organiser answered
    const asked = await who.coordinator.client.rpc("post_event_comment", {
      p_event_id: ids.asked, p_body: "Will alcohol be served?", p_parent_comment_id: null, p_mentions: [], p_clarification_request: true,
    });
    if (asked.error) throw new Error(asked.error.message);
    const question = await who.coordinator.client.rpc("post_event_comment", {
      p_event_id: ids.answered, p_body: "How many guests?", p_parent_comment_id: null, p_mentions: [], p_clarification_request: true,
    });
    if (question.error) throw new Error(question.error.message);
    const { data: q } = await admin.from("event_comments").select("id").eq("event_id", ids.answered).single();
    const reply = await who.organiserA.client.rpc("post_event_comment", {
      p_event_id: ids.answered, p_body: "About 80.", p_parent_comment_id: q!.id, p_mentions: [],
    });
    if (reply.error) throw new Error(reply.error.message);

    // a decided change request
    const { error } = await admin.from("event_change_requests").insert({
      event_id: ids.changed, requested_by: who.organiserA.userId, change_description: "IT-159 move", status: "rejected",
      reviewed_by: who.coordinator.userId, review_notes: "No", reviewed_at: "2031-02-01T00:00:00Z",
    });
    if (error) throw new Error(error.message);
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds);
  });

  it("SCRUM-159/AC1 lists the organiser's own events with their status, and never another organiser's", async () => {
    const res = await homeAs(who.organiserA);

    expect(res.status).toBe(200);
    expect(find(res.body, "plain")).toMatchObject({ name: "IT-159-plain", status: "submitted", expected_attendance: 80 });
    expect(find(res.body, "other")).toBeUndefined();
  });

  it("SCRUM-159/AC1 names the assigned coordinator, and has none for an event nobody was assigned to", async () => {
    const res = await homeAs(who.organiserA);

    expect(find(res.body, "coordinated")!.coordinator_name).toBeTruthy();
    expect(find(res.body, "plain")!.coordinator_name).toBeNull();
  });

  it("SCRUM-159/AC2 includes a clarification request the organiser has not answered, with who asked and what", async () => {
    const res = await homeAs(who.organiserA);

    expect(find(res.body, "asked")!.clarification).toMatchObject({ text: "Will alcohol be served?" });
    expect(find(res.body, "asked")!.clarification.author_name).toBeTruthy();
  });

  it("SCRUM-159/AC2 leaves out a clarification request the organiser has answered, and an event with none", async () => {
    const res = await homeAs(who.organiserA);

    expect(find(res.body, "answered")!.clarification).toBeNull();
    expect(find(res.body, "plain")!.clarification).toBeNull();
  });

  it("SCRUM-159/AC3 includes the outcome of a decided change request, and none for an event without one", async () => {
    const res = await homeAs(who.organiserA);

    expect(find(res.body, "changed")!.change_outcome).toMatchObject({ status: "rejected" });
    expect(find(res.body, "plain")!.change_outcome).toBeNull();
  });

  it("SCRUM-159/AC1 refuses anyone who is not an organiser", async () => {
    expect((await homeAs(who.attendee)).status).toBe(403);
    expect((await homeAs(who.coordinator)).status).toBe(403);
  });
});
