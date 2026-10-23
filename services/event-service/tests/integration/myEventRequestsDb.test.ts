import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createSupabaseDeps } from "../../src/supabase";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-52: GET /events/my-requests against the real database, as the signed-in user so events RLS (migration 14) applies.
 * Fixtures are made with the secret key, named "IT-52-", dated 2031 and removed afterwards. The seeded organisers have other
 * events too, so these tests only look at their own fixtures.
 */
const EMAILS = {
  organiserA: "jason.chua@techconnect.example.com",
  organiserB: "weiling.ong@techconnect.example.com",
  coordinator: "rachel.tan@connectsphere.example.com",
  venueStaff: "kenneth.wong@connectsphere.example.com",
  attendee: "alicia.fernandez@example.com",
};

describe.skipIf(!hasDb)("SCRUM-52 my event requests (GET /events/my-requests)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const app = hasDb ? createApp(createSupabaseDeps()) : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];
  const ids = {} as Record<string, string>;

  async function newEvent(key: string, organiser: Actor, fields: Record<string, unknown> = {}) {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-52-${key}`,
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

  const listAs = (actor: Actor) => request(app).get("/events/my-requests").set("Cookie", `cs_session=${actor.token}`);
  /** The fixtures in a response (other suites' and seeded events are ignored). */
  const mine = (body: Array<{ id: string }>) => body.map((e) => e.id).filter((id) => eventIds.includes(id));

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Array<keyof typeof EMAILS>) who[key] = await signInAs(EMAILS[key]);
    await newEvent("aDraft", who.organiserA, { status: "draft", is_draft: true, submitted_at: null });
    await newEvent("aApproved", who.organiserA, { status: "approved" });
    await newEvent("aSubmitted", who.organiserA);
    await newEvent("bSubmitted", who.organiserB);
    await newEvent("bRejected", who.organiserB, { status: "rejected" });
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds);
  });

  it("SCRUM-52/AC1 lists the organiser's requests in every status, with the status each has", async () => {
    const res = await listAs(who.organiserA);

    expect(res.status).toBe(200);
    const byId = new Map<string, { status: string; name: string }>(res.body.map((e: { id: string; status: string; name: string }) => [e.id, e]));
    expect(byId.get(ids.aDraft)?.status).toBe("draft");
    expect(byId.get(ids.aApproved)?.status).toBe("approved");
    expect(byId.get(ids.aSubmitted)).toMatchObject({ name: "IT-52-aSubmitted", status: "submitted" });
  });

  it("SCRUM-52/AC2 shows organiser A none of organiser B's requests", async () => {
    const res = await listAs(who.organiserA);

    expect(mine(res.body).sort()).toEqual([ids.aDraft, ids.aApproved, ids.aSubmitted].sort());
  });

  it("SCRUM-52/AC2 shows organiser B none of organiser A's requests", async () => {
    const res = await listAs(who.organiserB);

    expect(mine(res.body).sort()).toEqual([ids.bSubmitted, ids.bRejected].sort());
  });

  it.each(["coordinator", "venueStaff", "attendee"] as const)("SCRUM-52/AC2 refuses the %s with 403", async (key) => {
    const res = await listAs(who[key]);

    expect(res.status).toBe(403);
  });

  it("SCRUM-52/AC1 answers 401 without a session", async () => {
    const res = await request(app).get("/events/my-requests");

    expect(res.status).toBe(401);
  });
});
