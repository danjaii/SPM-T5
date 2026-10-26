import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createSupabaseDeps } from "../../src/supabase";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-54: reopening, re-saving and submitting a draft (migration 53: organiser UPDATE policy, column guard,
 * update_event_draft(), submit_event_draft()) against the real database, as seeded users so RLS applies. Fixtures are named
 * "IT-54-" and removed afterwards (history, then events). The seeded organisers and the Lead's queue hold other rows, so
 * these tests only look at rows they create.
 */
const EMAILS = {
  organiser: "jason.chua@techconnect.example.com",
  otherOrganiser: "weiling.ong@techconnect.example.com",
  coordinator: "rachel.tan@connectsphere.example.com",
  lead: "helen.ong@connectsphere.example.com",
  attendee: "alicia.fernandez@example.com",
};

/** Postgres "insufficient_privilege": an RLS policy or guard denied the write. */
const DENIED = "42501";

describe.skipIf(!hasDb)("SCRUM-54 resume a draft against the database", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const app = hasDb ? createApp(createSupabaseDeps()) : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];
  let layoutId: string;

  const cookie = (actor: Actor) => `cs_session=${actor.token}`;
  const track = (id: string) => {
    eventIds.push(id);
    return id;
  };
  /** A draft owned by `actor`, made the way the app makes it. */
  async function newDraft(actor: Actor, fields: Record<string, unknown> = {}): Promise<Record<string, any>> {
    const { data, error } = await actor.client.rpc("create_event_draft", fields);
    if (error) throw new Error(error.message);
    track(data.id);
    return data;
  }
  const getDraft = (actor: Actor, id: string) => request(app).get(`/events/drafts/${id}`).set("Cookie", cookie(actor));
  const stored = async (id: string) => (await admin.from("events").select("*").eq("id", id).single()).data as Record<string, any>;

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Array<keyof typeof EMAILS>) who[key] = await signInAs(EMAILS[key]);
    const { data } = await admin.from("room_layouts").select("id").limit(1).single();
    layoutId = data!.id;
  });

  afterAll(async () => {
    if (eventIds.length === 0) return;
    await admin.from("event_status_history").delete().in("event_id", eventIds);
    await admin.from("events").delete().in("id", eventIds);
  });

  describe("SCRUM-54/AC1 open a saved draft", () => {
    it("returns the stored fields of the owner's draft, ids included", async () => {
      const draft = await newDraft(who.organiser, {
        p_name: "IT-54-AC1-open",
        p_purpose: "Showcase",
        p_expected_attendance: 75,
        p_preferred_room_layout_id: layoutId,
        p_registration_required: true,
        p_registration_capacity: 60,
      });

      const res = await getDraft(who.organiser, draft.id);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: draft.id,
        name: "IT-54-AC1-open",
        purpose: "Showcase",
        expected_attendance: 75,
        preferred_room_layout_id: layoutId,
        registration_required: true,
        registration_capacity: 60,
        description: null,
        status: "draft",
        is_draft: true,
      });
      expect(new Date(res.body.updated_at).getTime()).toBe(new Date(draft.updated_at).getTime());
    });

    it("answers 404 for an id that does not exist", async () => {
      const res = await getDraft(who.organiser, "00000000-0000-4000-8000-000000000000");
      expect(res.status).toBe(404);
    });
  });

  describe("SCRUM-54/AC2 re-save a draft", () => {
    const putAs = (actor: Actor, id: string, body: unknown) =>
      request(app).put(`/events/drafts/${id}`).set("Cookie", cookie(actor)).send(body as object);

    it("updates the draft through PUT and moves updated_at forward", async () => {
      const draft = await newDraft(who.organiser, { p_name: "IT-54-AC2-before", p_expected_attendance: 10 });
      await new Promise((resolve) => setTimeout(resolve, 20));

      const res = await putAs(who.organiser, draft.id, { name: "IT-54-AC2-after", expected_attendance: 90, purpose: "Edited" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: draft.id, name: "IT-54-AC2-after", expected_attendance: 90, purpose: "Edited", status: "draft" });
      expect(new Date(res.body.updated_at).getTime()).toBeGreaterThan(new Date(draft.updated_at).getTime());
      expect(await stored(draft.id)).toMatchObject({ name: "IT-54-AC2-after", expected_attendance: 90, updated_at: res.body.updated_at });
    });

    it("clears a field the organiser emptied and names a blank draft Untitled draft", async () => {
      const draft = await newDraft(who.organiser, { p_name: "IT-54-AC2-clear", p_purpose: "Gone soon", p_expected_attendance: 5 });

      const res = await putAs(who.organiser, draft.id, { name: "   ", purpose: "", expected_attendance: null });

      expect(res.status).toBe(200);
      expect(await stored(draft.id)).toMatchObject({ name: "Untitled draft", purpose: null, expected_attendance: null });
    });

    it("answers 422 and changes nothing for a value the table would refuse", async () => {
      const draft = await newDraft(who.organiser, { p_name: "IT-54-AC2-422", p_expected_attendance: 5 });

      const res = await putAs(who.organiser, draft.id, { name: "IT-54-AC2-changed", expected_attendance: -1 });

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toHaveProperty("expected_attendance");
      expect(await stored(draft.id)).toMatchObject({ name: "IT-54-AC2-422", expected_attendance: 5 });
    });

    it("lets the owner change the fields of their draft directly (the UPDATE policy)", async () => {
      const draft = await newDraft(who.organiser, { p_name: "IT-54-AC2-direct" });
      const { data, error } = await who.organiser.client.from("events").update({ name: "IT-54-AC2-direct-2" }).eq("id", draft.id).select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it.each([
      ["organiser_id", () => who.otherOrganiser.userId],
      ["client_organisation_id", () => "00000000-0000-4000-8000-000000000000"],
      ["assigned_coordinator_id", () => who.coordinator.userId],
      ["cloned_from_event_id", () => "00000000-0000-4000-8000-000000000000"],
      ["created_at", () => "2001-01-01T00:00:00Z"],
      ["confirmed_at", () => "2031-01-01T00:00:00Z"],
    ])("refuses the owner changing %s on their draft, directly or through the API", async (column, value) => {
      const draft = await newDraft(who.organiser, { p_name: `IT-54-AC2-${column}` });
      const before = await stored(draft.id);

      const direct = await who.organiser.client.from("events").update({ [column]: value() }).eq("id", draft.id).select("id");
      expect(direct.data ?? []).toEqual([]);

      const viaApi = await putAs(who.organiser, draft.id, { name: `IT-54-AC2-${column}`, [column]: value() });
      expect(viaApi.status).toBe(200);
      const after = await stored(draft.id);
      expect(after[column]).toEqual(before[column]);
    });

    it.each([
      ["status", "submitted"],
      ["is_draft", false],
      ["submitted_at", "2031-01-01T00:00:00Z"],
    ])("refuses the owner setting %s by a plain update, so a draft cannot submit itself", async (column, value) => {
      const draft = await newDraft(who.organiser, { p_name: `IT-54-AC2-plain-${column}` });

      const res = await who.organiser.client.from("events").update({ [column]: value }).eq("id", draft.id).select("id");

      expect(res.data ?? []).toEqual([]);
      expect(await stored(draft.id)).toMatchObject({ status: "draft", is_draft: true, submitted_at: null });
    });
  });

  describe("SCRUM-54/AC3 submit a draft", () => {
    const submitAs = (actor: Actor, id: string, body?: unknown) => {
      const req = request(app).post(`/events/drafts/${id}/submit`).set("Cookie", cookie(actor));
      return body === undefined ? req : req.send(body as object);
    };
    /** Every mandatory field, in the shape of the create_event_draft arguments. */
    const completeArgs = (name: string) => ({
      p_name: name,
      p_purpose: "Integration test",
      p_description: "Made by eventDraftResumeDb.test.ts",
      p_preferred_start_datetime: "2031-05-03T09:00:00Z",
      p_preferred_end_datetime: "2031-05-03T17:00:00Z",
      p_expected_attendance: 40,
      p_venue_requirements: "Projector",
      p_preferred_room_layout_id: layoutId,
      p_accessibility_requirements: "None required",
      p_equipment_requirements_notes: "None required",
    });

    it("changes a complete draft from Draft to Submitted with submitted_at set and no coordinator", async () => {
      const draft = await newDraft(who.organiser, completeArgs("IT-54-AC3-submit"));

      const res = await submitAs(who.organiser, draft.id);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: draft.id, status: "submitted", is_draft: false, assigned_coordinator_id: null });
      expect(res.body.submitted_at).toEqual(expect.any(String));
      expect(await stored(draft.id)).toMatchObject({ status: "submitted", is_draft: false, assigned_coordinator_id: null });
    });

    it("writes one draft -> submitted history row in the organiser's name", async () => {
      const draft = await newDraft(who.organiser, completeArgs("IT-54-AC3-history"));
      await submitAs(who.organiser, draft.id);

      const { data: history } = await admin.from("event_status_history").select("*").eq("event_id", draft.id);

      expect(history).toHaveLength(1);
      expect(history![0]).toMatchObject({ old_status: "draft", new_status: "submitted", changed_by: who.organiser.userId });
    });

    it("sends the organiser no notification for submitting", async () => {
      const draft = await newDraft(who.organiser, completeArgs("IT-54-AC3-notify"));
      await submitAs(who.organiser, draft.id);

      const { data } = await admin.from("notifications").select("id").eq("event_id", draft.id);

      expect(data ?? []).toHaveLength(0);
    });

    it("puts the request in the Event Coordinator Lead's unassigned queue", async () => {
      const draft = await newDraft(who.organiser, completeArgs("IT-54-AC3-queue"));
      const before = await who.lead.client.rpc("lead_unassigned_queue");
      expect((before.data as Array<{ id: string }>).some((r) => r.id === draft.id)).toBe(false);

      const res = await submitAs(who.organiser, draft.id);

      const { data, error } = await who.lead.client.rpc("lead_unassigned_queue");
      expect(error).toBeNull();
      const row = (data as Array<Record<string, unknown>>).find((r) => r.id === draft.id);
      expect(row).toMatchObject({ name: "IT-54-AC3-queue", organiser_name: "Jason Chua", expected_attendance: 40 });
      expect(new Date(row!.submitted_at as string).getTime()).toBe(new Date(res.body.submitted_at).getTime());
    });

    it("saves and submits in one call when the fields are sent as the body", async () => {
      const draft = await newDraft(who.organiser, { p_name: "IT-54-AC3-body" });

      const res = await submitAs(who.organiser, draft.id, {
        name: "IT-54-AC3-body-final",
        purpose: "From the form",
        description: "Sent with the submit",
        preferred_start_datetime: "2031-05-03T09:00:00Z",
        preferred_end_datetime: "2031-05-03T17:00:00Z",
        expected_attendance: 55,
        venue_requirements: "Stage",
        preferred_room_layout_id: layoutId,
        accessibility_requirements: "None required",
        equipment_requirements_notes: "None required",
        registration_required: false,
        registration_capacity: 20,
      });

      expect(res.status).toBe(200);
      expect(await stored(draft.id)).toMatchObject({
        name: "IT-54-AC3-body-final",
        expected_attendance: 55,
        status: "submitted",
        registration_capacity: null,
      });
    });

    it("refuses an incomplete draft with 422 and field errors, and it is still a draft", async () => {
      const draft = await newDraft(who.organiser, { p_name: "IT-54-AC3-incomplete", p_purpose: "Only this" });
      const before = await stored(draft.id);

      const res = await submitAs(who.organiser, draft.id);

      expect(res.status).toBe(422);
      expect(res.body.code).toBe("VALIDATION_FAILED");
      expect(res.body.fieldErrors).toHaveProperty("description");
      expect(res.body.fieldErrors).toHaveProperty("preferred_start_datetime");
      const after = await stored(draft.id);
      expect(after).toMatchObject({ status: "draft", is_draft: true, submitted_at: null });
      expect(after.updated_at).toBe(before.updated_at);
      const { data: history } = await admin.from("event_status_history").select("id").eq("event_id", draft.id);
      expect(history).toHaveLength(0);
    });

    it("refuses an incomplete draft in the database too (DR003) when the service is skipped", async () => {
      const draft = await newDraft(who.organiser, { p_name: "IT-54-AC3-db-incomplete" });

      const { error } = await who.organiser.client.rpc("submit_event_draft", { p_event_id: draft.id });

      expect(error?.code).toBe("DR003");
      expect(await stored(draft.id)).toMatchObject({ status: "draft" });
    });
  });
});
