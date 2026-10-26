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

    it.each([
      ["name", "IT-54-AC2-direct"],
      ["purpose", "Direct"],
      ["organiser_id", () => who.otherOrganiser.userId],
      ["client_organisation_id", () => "00000000-0000-4000-8000-000000000000"],
      ["cloned_from_event_id", () => "00000000-0000-4000-8000-000000000000"],
      ["created_at", "2001-01-01T00:00:00Z"],
      ["confirmed_at", "2031-01-01T00:00:00Z"],
    ])("refuses the owner updating %s on their draft directly: authenticated has no UPDATE privilege on it", async (column, value) => {
      const draft = await newDraft(who.organiser, { p_name: `IT-54-AC2-direct-${column}` });
      const before = await stored(draft.id);

      const res = await who.organiser.client
        .from("events")
        .update({ [column]: typeof value === "function" ? value() : value })
        .eq("id", draft.id)
        .select("id");

      expect(res.error?.code).toBe(DENIED);
      expect(await stored(draft.id)).toEqual(before);
    });

    it("changes only the 14 draft fields through the API, whatever else the body names", async () => {
      const draft = await newDraft(who.organiser, { p_name: "IT-54-AC2-whitelist" });
      const before = await stored(draft.id);

      const res = await putAs(who.organiser, draft.id, {
        name: "IT-54-AC2-whitelist-saved",
        organiser_id: who.otherOrganiser.userId,
        client_organisation_id: "00000000-0000-4000-8000-000000000000",
        assigned_coordinator_id: who.coordinator.userId,
        cloned_from_event_id: "00000000-0000-4000-8000-000000000000",
        created_at: "2001-01-01T00:00:00Z",
        confirmed_at: "2031-01-01T00:00:00Z",
        status: "approved",
        is_draft: false,
        submitted_at: "2031-01-01T00:00:00Z",
      });

      expect(res.status).toBe(200);
      const after = await stored(draft.id);
      expect(after.name).toBe("IT-54-AC2-whitelist-saved");
      for (const column of ["organiser_id", "client_organisation_id", "assigned_coordinator_id", "cloned_from_event_id", "created_at", "confirmed_at", "status", "is_draft", "submitted_at"]) {
        expect(after[column]).toEqual(before[column]);
      }
    });

    it("refuses a non-organiser calling update_event_draft (42501)", async () => {
      const draft = await newDraft(who.organiser, { p_name: "IT-54-AC2-role" });
      for (const key of ["coordinator", "attendee"] as const) {
        const { error } = await who[key].client.rpc("update_event_draft", { p_event_id: draft.id, p_name: "IT-54-AC2-hijacked" });
        expect(error?.code).toBe(DENIED);
      }
      expect(await stored(draft.id)).toMatchObject({ name: "IT-54-AC2-role" });
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

  describe("SCRUM-54/AC4 only the owner uses the draft flow, and only while it is a draft", () => {
    const send = (method: "get" | "put" | "post", actor: Actor | undefined, id: string, suffix = "") => {
      const req = request(app)[method](`/events/drafts/${id}${suffix}`);
      return actor ? req.set("Cookie", cookie(actor)) : req;
    };
    const FIELDS = {
      name: "IT-54-AC4-complete",
      purpose: "Integration test",
      description: "Made by eventDraftResumeDb.test.ts",
      preferred_start_datetime: "2031-05-03T09:00:00Z",
      preferred_end_datetime: "2031-05-03T17:00:00Z",
      expected_attendance: 40,
      venue_requirements: "Projector",
      accessibility_requirements: "None required",
      equipment_requirements_notes: "None required",
    };
    let draftId: string;
    let submittedId: string;

    beforeAll(async () => {
      draftId = (await newDraft(who.organiser, { p_name: "IT-54-AC4-draft", p_purpose: "Private" })).id;
      submittedId = (await newDraft(who.organiser, { p_name: "IT-54-AC4-submitted" })).id;
      const { error } = await who.organiser.client.rpc("submit_event_draft", { p_event_id: submittedId });
      // the draft above is incomplete on purpose, so submit this one through the service with the complete fields
      expect(error?.code).toBe("DR003");
      const res = await request(app)
        .post(`/events/drafts/${submittedId}/submit`)
        .set("Cookie", cookie(who.organiser))
        .send({ ...FIELDS, preferred_room_layout_id: layoutId });
      expect(res.status).toBe(200);
    });

    it("answers 404 to another organiser reading, re-saving or submitting the draft, and changes nothing", async () => {
      expect((await send("get", who.otherOrganiser, draftId)).status).toBe(404);
      expect((await send("put", who.otherOrganiser, draftId).send({ name: "IT-54-AC4-hijacked" })).status).toBe(404);
      expect((await send("post", who.otherOrganiser, draftId, "/submit")).status).toBe(404);
      expect(await stored(draftId)).toMatchObject({ name: "IT-54-AC4-draft", status: "draft", purpose: "Private" });
    });

    it.each(["coordinator", "attendee", "lead"] as const)("answers 403 to a %s on every draft route", async (key) => {
      expect((await send("get", who[key], draftId)).status).toBe(403);
      expect((await send("put", who[key], draftId).send({ name: "IT-54-AC4-hijacked" })).status).toBe(403);
      expect((await send("post", who[key], draftId, "/submit")).status).toBe(403);
      expect(await stored(draftId)).toMatchObject({ name: "IT-54-AC4-draft", status: "draft" });
    });

    it("answers 401 without a session", async () => {
      expect((await send("get", undefined, draftId)).status).toBe(401);
      expect((await send("put", undefined, draftId).send({})).status).toBe(401);
      expect((await send("post", undefined, draftId, "/submit")).status).toBe(401);
    });

    it.each(["otherOrganiser", "coordinator", "attendee"] as const)("lets a %s neither update nor submit the draft in the database", async (key) => {
      const direct = await who[key].client.from("events").update({ name: "IT-54-AC4-hijacked" }).eq("id", draftId).select("id");
      expect(direct.data ?? []).toEqual([]);
      expect(direct.error?.code).toBe(DENIED);
      const resave = await who[key].client.rpc("update_event_draft", { p_event_id: draftId, p_name: "IT-54-AC4-hijacked" });
      expect(resave.error?.code).toBe(key === "otherOrganiser" ? "DR001" : DENIED);
      const submit = await who[key].client.rpc("submit_event_draft", { p_event_id: draftId });
      expect(submit.error?.code).toBe(key === "otherOrganiser" ? "DR001" : DENIED);
      expect(await stored(draftId)).toMatchObject({ name: "IT-54-AC4-draft", status: "draft" });
    });

    it("answers 409 NOT_A_DRAFT to the owner on every draft route once the request is submitted", async () => {
      const get = await send("get", who.organiser, submittedId);
      expect(get.status).toBe(409);
      expect(get.body.code).toBe("NOT_A_DRAFT");
      const put = await send("put", who.organiser, submittedId).send({ name: "IT-54-AC4-edited" });
      expect(put.status).toBe(409);
      expect(put.body.code).toBe("NOT_A_DRAFT");
      const submit = await send("post", who.organiser, submittedId, "/submit");
      expect(submit.status).toBe(409);
      expect(submit.body.code).toBe("NOT_A_DRAFT");
      expect(await stored(submittedId)).toMatchObject({ name: "IT-54-AC4-complete", status: "submitted" });
      const { data: history } = await admin.from("event_status_history").select("id").eq("event_id", submittedId);
      expect(history).toHaveLength(1);
    });

    it("leaves a submitted request untouched by the owner's direct updates, so it cannot go back to draft", async () => {
      for (const change of [{ name: "IT-54-AC4-edited" }, { status: "draft" }, { is_draft: true }, { submitted_at: null }]) {
        const res = await who.organiser.client.from("events").update(change).eq("id", submittedId).select("id");
        expect(res.data ?? []).toEqual([]);
      }
      const resave = await who.organiser.client.rpc("update_event_draft", { p_event_id: submittedId, p_name: "IT-54-AC4-edited" });
      expect(resave.error?.code).toBe("DR002");
      const again = await who.organiser.client.rpc("submit_event_draft", { p_event_id: submittedId });
      expect(again.error?.code).toBe("DR002");
      expect(await stored(submittedId)).toMatchObject({ name: "IT-54-AC4-complete", status: "submitted", is_draft: false });
    });

    it("still gives the organiser no way to delete an event", async () => {
      const del = await who.organiser.client.from("events").delete().eq("id", draftId).select("id");
      expect(del.data ?? []).toEqual([]);
      expect(await stored(draftId)).toMatchObject({ status: "draft" });
    });
  });
});
