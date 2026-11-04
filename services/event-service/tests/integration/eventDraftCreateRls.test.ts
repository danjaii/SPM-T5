import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createSupabaseDeps } from "../../src/supabase";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { adminClient, DB_ENV, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-53: saving a draft (migration 70: create_event_draft(), with no organiser INSERT policy) against the real
 * database, as seeded users so RLS applies. Fixtures are named "IT-53-" and removed afterwards (events, then history). The
 * seeded organisers have other events too, so these tests only look at rows they create.
 */
const EMAILS = {
  organiser: "jason.chua@techconnect.example.com",
  otherOrganiser: "weiling.ong@techconnect.example.com",
  coordinator: "rachel.tan@connectsphere.example.com",
  attendee: "alicia.fernandez@example.com",
};

/** Postgres "insufficient_privilege": an RLS policy denied the write. */
const DENIED = "42501";

describe.skipIf(!hasDb)("SCRUM-53 save a draft against the database", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const app = hasDb ? createApp(createSupabaseDeps()) : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];

  const params = (name: string | null, extra: Record<string, unknown> = {}) => ({ p_name: name, ...extra });
  const track = (id: string) => {
    eventIds.push(id);
    return id;
  };
  const postAs = (actor: Actor, body: unknown) => request(app).post("/events/drafts").set("Cookie", `cs_session=${actor.token}`).send(body as object);

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Array<keyof typeof EMAILS>) who[key] = await signInAs(EMAILS[key]);
  });

  afterAll(async () => {
    if (eventIds.length === 0) return;
    await admin.from("event_status_history").delete().in("event_id", eventIds);
    await admin.from("events").delete().in("id", eventIds);
  });

  describe("SCRUM-53/AC1 create_event_draft stores a draft", () => {
    it("stores an incomplete request as a draft owned by the caller, with no history row", async () => {
      const { data, error } = await who.organiser.client.rpc("create_event_draft", params("IT-53-AC1-incomplete", { p_expected_attendance: 30 }));
      expect(error).toBeNull();
      track(data.id);
      expect(data).toMatchObject({
        name: "IT-53-AC1-incomplete",
        status: "draft",
        is_draft: true,
        submitted_at: null,
        organiser_id: who.organiser.userId,
        expected_attendance: 30,
        purpose: null,
      });

      const { data: history } = await admin.from("event_status_history").select("id").eq("event_id", data.id);
      expect(history).toHaveLength(0);
    });

    it("takes the client organisation from the caller's users row", async () => {
      const { data: profile } = await admin.from("users").select("organisation_id").eq("id", who.organiser.userId).single();
      const { data, error } = await who.organiser.client.rpc("create_event_draft", params("IT-53-AC1-organisation"));
      expect(error).toBeNull();
      track(data.id);
      expect(data.client_organisation_id).toBe(profile!.organisation_id);
    });

    it("saves through POST /events/drafts and the draft appears in GET /events/my-requests as draft", async () => {
      const res = await postAs(who.organiser, { name: "IT-53-AC1-http", expected_attendance: 12 });
      expect(res.status).toBe(201);
      track(res.body.id);
      expect(res.body).toMatchObject({ status: "draft", is_draft: true, organiser_id: who.organiser.userId });

      const list = await request(app).get("/events/my-requests").set("Cookie", `cs_session=${who.organiser.token}`);
      expect(list.status).toBe(200);
      expect(list.body.find((e: { id: string }) => e.id === res.body.id)).toMatchObject({ status: "draft" });
    });
  });

  describe("SCRUM-53/AC2 an incomplete draft is not blocked", () => {
    it.each([null, "", "   "])("stores a draft whose name is %j as 'Untitled draft'", async (name) => {
      const { data, error } = await who.organiser.client.rpc("create_event_draft", params(name));
      expect(error).toBeNull();
      track(data.id);
      expect(data).toMatchObject({ name: "Untitled draft", status: "draft", registration_required: false });
    });

    it("stores a draft with no fields at all", async () => {
      const { data, error } = await who.organiser.client.rpc("create_event_draft");
      expect(error).toBeNull();
      track(data.id);
      expect(data).toMatchObject({ name: "Untitled draft", purpose: null, expected_attendance: null, preferred_start_datetime: null });
    });

    it("saves an empty body through POST /events/drafts", async () => {
      const res = await postAs(who.organiser, {});
      expect(res.status).toBe(201);
      track(res.body.id);
      expect(res.body).toMatchObject({ name: "Untitled draft", status: "draft" });
    });

    it("answers 422 and stores nothing for a value the table would refuse", async () => {
      const res = await postAs(who.organiser, { name: "IT-53-AC2-negative", expected_attendance: -3 });
      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toHaveProperty("expected_attendance");
      const { data } = await admin.from("events").select("id").eq("name", "IT-53-AC2-negative");
      expect(data).toHaveLength(0);
    });

    it("answers 422 on preferred_room_layout_id, and stores nothing, for a layout that does not exist", async () => {
      const res = await postAs(who.organiser, { name: "IT-53-AC2-layout", preferred_room_layout_id: "11111111-1111-4111-8111-111111111111" });
      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toHaveProperty("preferred_room_layout_id");
      const { data } = await admin.from("events").select("id").eq("name", "IT-53-AC2-layout");
      expect(data).toHaveLength(0);
    });

    it("leaves the table's own check constraints in force (negative attendance is refused by the database)", async () => {
      const { error } = await who.organiser.client.rpc("create_event_draft", params("IT-53-AC2-check", { p_expected_attendance: -1 }));
      expect(error?.code).toBe("23514");
    });
  });

  describe("SCRUM-53/AC3 the last-saved time is recorded", () => {
    /** How far the database clock may be from this machine's clock, in ms (the test and the database share a host). */
    const CLOCK_TOLERANCE_MS = 10_000;

    it("returns updated_at as a recent timestamp that matches the stored row", async () => {
      const before = Date.now();
      const { data, error } = await who.organiser.client.rpc("create_event_draft", params("IT-53-AC3-updated-at"));
      const after = Date.now();
      expect(error).toBeNull();
      track(data.id);

      expect(typeof data.updated_at).toBe("string");
      const returned = new Date(data.updated_at).getTime();
      expect(Number.isNaN(returned)).toBe(false);
      expect(returned).toBeGreaterThanOrEqual(before - CLOCK_TOLERANCE_MS);
      expect(returned).toBeLessThanOrEqual(after + CLOCK_TOLERANCE_MS);

      const { data: stored } = await admin.from("events").select("updated_at").eq("id", data.id).single();
      expect(new Date(stored!.updated_at).getTime()).toBe(returned);
    });

    it("returns updated_at from POST /events/drafts", async () => {
      const before = Date.now();
      const res = await postAs(who.organiser, { name: "IT-53-AC3-http" });
      const after = Date.now();
      expect(res.status).toBe(201);
      track(res.body.id);
      const returned = new Date(res.body.updated_at).getTime();
      expect(returned).toBeGreaterThanOrEqual(before - CLOCK_TOLERANCE_MS);
      expect(returned).toBeLessThanOrEqual(after + CLOCK_TOLERANCE_MS);
    });
  });

  describe("SCRUM-53/AC1 a client cannot choose the status, submission time or owner of a draft", () => {
    it("ignores status, submitted_at, organiser_id and assigned_coordinator_id sent to POST /events/drafts", async () => {
      const res = await postAs(who.organiser, {
        name: "IT-53-AC1-spoofed",
        status: "approved",
        is_draft: false,
        submitted_at: "2001-01-01T00:00:00.000Z",
        organiser_id: who.otherOrganiser.userId,
        assigned_coordinator_id: who.coordinator.userId,
      });
      expect(res.status).toBe(201);
      track(res.body.id);
      expect(res.body).toMatchObject({ status: "draft", is_draft: true, submitted_at: null, organiser_id: who.organiser.userId, assigned_coordinator_id: null });
      const { data: stored } = await admin.from("events").select("status, is_draft, submitted_at, organiser_id, assigned_coordinator_id").eq("id", res.body.id).single();
      expect(stored).toEqual({ status: "draft", is_draft: true, submitted_at: null, organiser_id: who.organiser.userId, assigned_coordinator_id: null });
      const { data: history } = await admin.from("event_status_history").select("id").eq("event_id", res.body.id);
      expect(history).toHaveLength(0);
    });

    it("has no way to pass a status or submission time to create_event_draft: the database refuses the unknown arguments and stores nothing", async () => {
      const client = createClient(DB_ENV.url!, DB_ENV.publishableKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${who.organiser.token}` } },
      });
      const { data, error } = await client.rpc("create_event_draft", params("IT-53-AC1-rpc-spoof", { p_status: "approved", p_submitted_at: "2001-01-01T00:00:00.000Z" }));
      expect(data).toBeNull();
      expect(error?.code).toBe("PGRST202");
      const { data: rows } = await admin.from("events").select("id").eq("name", "IT-53-AC1-rpc-spoof");
      expect(rows).toHaveLength(0);
    });
  });

  describe("SCRUM-53/AC3 a client cannot choose the last-saved time", () => {
    it("ignores an updated_at and created_at sent to POST /events/drafts: both are the server's, and the stored row agrees", async () => {
      const before = Date.now();
      const res = await postAs(who.organiser, {
        name: "IT-53-AC3-backdated",
        updated_at: "2001-01-01T00:00:00.000Z",
        created_at: "2001-01-01T00:00:00.000Z",
      });
      const after = Date.now();
      expect(res.status).toBe(201);
      track(res.body.id);
      for (const field of ["updated_at", "created_at"] as const) {
        const returned = new Date(res.body[field]).getTime();
        expect(returned).toBeGreaterThanOrEqual(before - 10_000);
        expect(returned).toBeLessThanOrEqual(after + 10_000);
      }
      const { data: stored } = await admin.from("events").select("updated_at, created_at").eq("id", res.body.id).single();
      expect(new Date(stored!.updated_at).getTime()).toBe(new Date(res.body.updated_at).getTime());
      expect(new Date(stored!.created_at).getTime()).toBe(new Date(res.body.created_at).getTime());
    });
  });

  describe("SCRUM-53/AC4 a draft is private to the organiser who created it", () => {
    let draftId: string;
    const DRAFT_NAME = "IT-53-AC4-private-draft";

    beforeAll(async () => {
      const { data, error } = await who.organiser.client.rpc("create_event_draft", params(DRAFT_NAME));
      expect(error).toBeNull();
      draftId = track(data.id);
    });

    // The whole stored row, read as admin, before and after every attempt: a refusal that left the row alone is the only pass.
    const storedRow = async () => (await admin.from("events").select("*").eq("id", draftId).single()).data;
    let snapshot: Record<string, unknown> | null;
    beforeAll(async () => {
      snapshot = await storedRow();
      expect(snapshot).toMatchObject({ name: DRAFT_NAME, status: "draft" });
    });
    const stillUntouched = async () => expect(await storedRow()).toEqual(snapshot);
    /** The one filter every attempt uses, so the control below checks the very filter that was tried. */
    const byDraft = <Q extends { eq(column: string, value: string): Q }>(query: Q): Q => query.eq("id", draftId);
    /** The attempts' filter must find the row as admin, or "0 rows affected" would prove nothing. */
    const filterFindsTheRow = async () => expect((await byDraft(admin.from("events").select("id"))).data).toEqual([{ id: draftId }]);
    /**
     * What each write attempt does today, measured against the database: the organiser/coordinator/attendee role has no UPDATE
     * privilege on the name column (42501, no rows), may be allowed to update status but sees no row to change (no error, 0 rows),
     * and has a delete privilege but no row to delete (no error, 0 rows). Each is asserted exactly, so an unexpected error or a
     * wrong filter cannot pass as "nothing happened".
     */
    async function attemptWrites(client: SupabaseClient) {
      const rename = await byDraft(client.from("events").update({ name: "IT-53-AC4-hijacked" })).select("id");
      expect(rename.error?.code).toBe(DENIED);
      expect(rename.data).toBeNull();
      await stillUntouched();

      const status = await byDraft(client.from("events").update({ status: "approved" })).select("id");
      expect(status.error).toBeNull();
      expect(status.data).toEqual([]);
      await stillUntouched();

      const del = await byDraft(client.from("events").delete()).select("id");
      expect(del.error).toBeNull();
      expect(del.data).toEqual([]);
      await stillUntouched();
      await filterFindsTheRow();
    }

    it("lets the owner read it", async () => {
      const { data } = await who.organiser.client.from("events").select("id").eq("id", draftId);
      expect(data).toHaveLength(1);
      const res = await request(app).get(`/events/${draftId}`).set("Cookie", `cs_session=${who.organiser.token}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: draftId, name: DRAFT_NAME, status: "draft" });
    });

    it.each(["otherOrganiser", "coordinator", "attendee"] as const)("hides it from a %s", async (key) => {
      const { data } = await who[key].client.from("events").select("id").eq("id", draftId);
      expect(data).toEqual([]);

      const res = await request(app).get(`/events/${draftId}`).set("Cookie", `cs_session=${who[key].token}`);
      expect([403, 404]).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain(DRAFT_NAME);
    });

    it("does not list it in another organiser's My event requests", async () => {
      const res = await request(app).get("/events/my-requests").set("Cookie", `cs_session=${who.otherOrganiser.token}`);
      expect(res.status).toBe(200);
      expect(res.body.map((e: { id: string }) => e.id)).not.toContain(draftId);
    });

    it.each(["otherOrganiser", "coordinator", "attendee"] as const)("lets a %s neither update nor delete it", async (key) => {
      await attemptWrites(who[key].client);
    });

    it("cannot be edited through the API by another organiser (no PATCH route reaches it)", async () => {
      const res = await request(app)
        .patch(`/events/${draftId}`)
        .set("Cookie", `cs_session=${who.otherOrganiser.token}`)
        .send({ name: "IT-53-AC4-hijacked" });
      expect(res.status).toBeGreaterThanOrEqual(400);
      await stillUntouched();
    });

    it("does not let the owner update or delete it directly yet (SCRUM-54 re-saves through a function)", async () => {
      await attemptWrites(who.organiser.client);
    });

    it("answers 401 to a signed-out GET /events/:id for a draft, and says nothing about it", async () => {
      const res = await request(app).get(`/events/${draftId}`);
      expect(res.status).toBe(401);
      expect(JSON.stringify(res.body)).not.toContain(DRAFT_NAME);
      // the same request with the owner's session does find it, so the 401 is about the session and not the id
      expect((await request(app).get(`/events/${draftId}`).set("Cookie", `cs_session=${who.organiser.token}`)).status).toBe(200);
    });

    it.each(["coordinator", "attendee"] as const)("refuses a %s saving a draft: 403 from the API, 42501 from the database", async (key) => {
      const res = await postAs(who[key], { name: `IT-53-AC4-${key}` });
      expect(res.status).toBe(403);
      const { error } = await who[key].client.rpc("create_event_draft", params(`IT-53-AC4-${key}-rpc`));
      expect(error?.code).toBe(DENIED);
      const { data } = await admin.from("events").select("id").like("name", `IT-53-AC4-${key}%`);
      expect(data).toHaveLength(0);
    });

    it("answers 401 to POST /events/drafts without a session", async () => {
      const res = await request(app).post("/events/drafts").send({ name: "IT-53-AC4-anonymous" });
      expect(res.status).toBe(401);
    });

    it.each([
      ["names a different organiser", { organiser_id: "OTHER" }],
      ["is approved", { status: "approved" }],
      ["is flagged as not a draft", { is_draft: false }],
      ["carries a submitted_at", { submitted_at: "2031-01-01T00:00:00Z" }],
      ["names a coordinator", { assigned_coordinator_id: "COORDINATOR" }],
      ["carries a confirmed_at", { confirmed_at: "2031-01-01T00:00:00Z" }],
    ])("refuses a direct draft insert that %s", async (label, extra) => {
      const resolved = Object.fromEntries(
        Object.entries(extra).map(([k, v]) => [k, v === "OTHER" ? who.otherOrganiser.userId : v === "COORDINATOR" ? who.coordinator.userId : v]),
      );
      const name = `IT-53-AC4-smuggle-${label}`;
      const { error } = await who.organiser.client.from("events").insert({
        name,
        organiser_id: who.organiser.userId,
        status: "draft",
        is_draft: true,
        ...resolved,
      });
      expect(error?.code).toBe(DENIED);
      const { data } = await admin.from("events").select("id").eq("name", name);
      expect(data).toHaveLength(0);
    });

    // The requirement changed (SCRUM-91 keeps events writable only through functions): this test used to expect the insert to
    // be accepted, when an earlier version of migration 70 had a direct organiser INSERT policy. create_event_draft() is now the only way in.
    it("refuses a plain direct draft insert by the organiser (create_event_draft is the only way to save one)", async () => {
      const { error } = await who.organiser.client.from("events").insert({
        name: "IT-53-AC4-plain-insert",
        organiser_id: who.organiser.userId,
        status: "draft",
        is_draft: true,
      });
      expect(error?.code).toBe(DENIED);
      const { data } = await admin.from("events").select("id").eq("name", "IT-53-AC4-plain-insert");
      expect(data).toHaveLength(0);
    });

    it("refuses create_event_draft to a caller who is not signed in", async () => {
      const anonymous = createClient(DB_ENV.url!, DB_ENV.publishableKey!, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await anonymous.rpc("create_event_draft", params("IT-53-AC4-anonymous-rpc"));
      expect(error?.code).toBe(DENIED);
      const { data } = await admin.from("events").select("id").eq("name", "IT-53-AC4-anonymous-rpc");
      expect(data).toHaveLength(0);
    });
  });
});
