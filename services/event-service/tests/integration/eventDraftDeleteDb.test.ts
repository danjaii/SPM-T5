import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createSupabaseDeps } from "../../src/supabase";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-56: DELETE /events/drafts/:id and delete_event_draft() (migration 85) against the real database, as seeded users so
 * RLS and privileges apply. Fixtures are made with the secret key (create_event_draft belongs to SCRUM-53 and is not needed),
 * named "IT-56-" and removed afterwards. The seeded organisers have other events, so these tests only look at their own rows.
 */
const EMAILS = {
  organiser: "jason.chua@techconnect.example.com",
  otherOrganiser: "weiling.ong@techconnect.example.com",
  coordinator: "rachel.tan@connectsphere.example.com",
  attendee: "alicia.fernandez@example.com",
};

/** Postgres "insufficient_privilege". */
const DENIED = "42501";
/** Postgres "foreign_key_violation". */
const FOREIGN_KEY = "23503";

describe.skipIf(!hasDb)("SCRUM-56 delete a draft against the database", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const app = hasDb ? createApp(createSupabaseDeps()) : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];

  const cookie = (actor: Actor) => `cs_session=${actor.token}`;
  /** A draft, or (status other than draft) a submitted request, owned by `owner`. */
  async function newEvent(owner: Actor, key: string, fields: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-56-${key}`,
        organiser_id: owner.userId,
        status: "draft",
        is_draft: true,
        ...fields,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(data.id as string);
    return data.id as string;
  }
  const submitted = (owner: Actor, key: string) =>
    newEvent(owner, key, {
      status: "submitted",
      is_draft: false,
      preferred_start_datetime: "2031-06-15T01:00:00Z",
      preferred_end_datetime: "2031-06-15T09:00:00Z",
      expected_attendance: 80,
      submitted_at: "2031-01-01T00:00:00Z",
    });
  const remove = (actor: Actor, id: string) => request(app).delete(`/events/drafts/${id}`).set("Cookie", cookie(actor));
  const exists = async (id: string) => ((await admin.from("events").select("id").eq("id", id)).data ?? []).length === 1;
  const listed = async (actor: Actor) => {
    const res = await request(app).get("/events/my-requests").set("Cookie", cookie(actor));
    return (res.body as Array<{ id: string }>).map((e) => e.id);
  };

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Array<keyof typeof EMAILS>) who[key] = await signInAs(EMAILS[key]);
  });

  afterAll(async () => {
    if (eventIds.length === 0) return;
    // copies first: cloned_from_event_id has no cascade
    await admin.from("events").delete().in("cloned_from_event_id", eventIds);
    await admin.from("events").delete().in("id", eventIds); // cascades history, sessions and the other child rows
  });

  describe("SCRUM-56/AC1 the owner deletes their draft", () => {
    it("SCRUM-56/AC1 removes the draft for good (204) and it leaves GET /events/my-requests", async () => {
      const id = await newEvent(who.organiser, "own");
      expect(await listed(who.organiser)).toContain(id);

      const res = await remove(who.organiser, id);

      expect(res.status).toBe(204);
      expect(await exists(id)).toBe(false);
      expect(await listed(who.organiser)).not.toContain(id);
    });

    it("SCRUM-56/AC1 leaves the owner's other requests alone", async () => {
      const draft = await newEvent(who.organiser, "sibling-draft");
      const other = await submitted(who.organiser, "sibling-submitted");

      await remove(who.organiser, draft);

      expect(await exists(other)).toBe(true);
    });

    it("SCRUM-56/AC1 removes the draft's own child rows with it (cascade), so nothing is orphaned", async () => {
      const id = await newEvent(who.organiser, "children");
      const history = await admin.from("event_status_history").insert({ event_id: id, old_status: null, new_status: "draft", changed_by: who.organiser.userId });
      if (history.error) throw new Error(history.error.message);
      const session = await admin
        .from("event_sessions")
        .insert({ event_id: id, session_name: "IT-56 session", session_date: "2031-06-15", start_time: "09:00", end_time: "10:00", sequence_no: 1 });
      if (session.error) throw new Error(session.error.message);

      expect((await remove(who.organiser, id)).status).toBe(204);

      expect((await admin.from("event_status_history").select("id").eq("event_id", id)).data).toHaveLength(0);
      expect((await admin.from("event_sessions").select("id").eq("event_id", id)).data).toHaveLength(0);
    });

    it("SCRUM-56/AC1 answers 404 the second time (already gone)", async () => {
      const id = await newEvent(who.organiser, "twice");
      expect((await remove(who.organiser, id)).status).toBe(204);
      expect((await remove(who.organiser, id)).status).toBe(404);
    });

    it("SCRUM-56/AC1 refuses another organiser's delete (404, the same as not found) and the draft stays", async () => {
      const id = await newEvent(who.organiser, "not-yours");

      const res = await remove(who.otherOrganiser, id);

      expect(res.status).toBe(404);
      expect(await exists(id)).toBe(true);
    });

    it("SCRUM-56/AC1 refuses a coordinator and an attendee (403) and the draft stays", async () => {
      const id = await newEvent(who.organiser, "wrong-role");

      expect((await remove(who.coordinator, id)).status).toBe(403);
      expect((await remove(who.attendee, id)).status).toBe(403);
      expect(await exists(id)).toBe(true);
    });

    it("SCRUM-56/AC1 delete_event_draft itself refuses a coordinator and an attendee (42501), whatever the route does", async () => {
      const id = await newEvent(who.organiser, "function-role");

      for (const actor of [who.coordinator, who.attendee]) {
        const { error } = await actor.client.rpc("delete_event_draft", { p_event_id: id });
        expect(error?.code).toBe(DENIED);
      }
      expect(await exists(id)).toBe(true);
    });

    it("SCRUM-56/AC1 refuses a direct table DELETE even by the owner: only the function deletes", async () => {
      const id = await newEvent(who.organiser, "direct");

      const { data } = await who.organiser.client.from("events").delete().eq("id", id).select("id");

      expect(data ?? []).toHaveLength(0);
      expect(await exists(id)).toBe(true);
    });

    it("SCRUM-56/AC1 refuses with 500 and keeps the draft when a copy still points at it (cloned_from_event_id has no cascade)", async () => {
      const id = await newEvent(who.organiser, "cloned-source");
      await newEvent(who.organiser, "cloned-copy", { cloned_from_event_id: id });

      const res = await remove(who.organiser, id);

      expect(res.status).toBe(500);
      expect(await exists(id)).toBe(true);
      const { error } = await who.organiser.client.rpc("delete_event_draft", { p_event_id: id });
      expect(error?.code).toBe(FOREIGN_KEY);
    });
  });

  describe("SCRUM-56/AC2 a submitted request cannot be deleted", () => {
    it("SCRUM-56/AC2 answers 409 NOT_A_DRAFT for the owner's submitted request and the row stays", async () => {
      const id = await submitted(who.organiser, "submitted");

      const res = await remove(who.organiser, id);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("NOT_A_DRAFT");
      expect(await exists(id)).toBe(true);
      expect(await listed(who.organiser)).toContain(id);
    });

    it("SCRUM-56/AC2 the function refuses it too (DR002), so a stale page or a hand-made call cannot delete it", async () => {
      const id = await submitted(who.organiser, "submitted-function");

      const { error } = await who.organiser.client.rpc("delete_event_draft", { p_event_id: id });

      expect(error?.code).toBe("DR002");
      expect(await exists(id)).toBe(true);
    });

    it.each(["under_review", "approved", "rejected", "planning", "confirmed", "completed", "cancelled"])(
      "SCRUM-56/AC2 a %s request is refused by the function (DR002) and stays",
      async (status) => {
        const id = await newEvent(who.organiser, `status-${status}`, {
          status,
          is_draft: false,
          preferred_start_datetime: "2031-06-15T01:00:00Z",
          preferred_end_datetime: "2031-06-15T09:00:00Z",
          expected_attendance: 80,
          submitted_at: "2031-01-01T00:00:00Z",
        });

        const { error } = await who.organiser.client.rpc("delete_event_draft", { p_event_id: id });

        expect(error?.code).toBe("DR002");
        expect(await exists(id)).toBe(true);
      },
    );

    it("SCRUM-56/AC2 a row whose status is draft but is_draft is false is not deleted either", async () => {
      const id = await newEvent(who.organiser, "inconsistent", { is_draft: false });

      const { error } = await who.organiser.client.rpc("delete_event_draft", { p_event_id: id });

      expect(error?.code).toBe("DR002");
      expect(await exists(id)).toBe(true);
    });
  });
});
