import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createSupabaseDeps } from "../../src/supabase";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-53: saving a draft (migration 52: create_event_draft() and the organiser draft INSERT policy) against the real
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
});
