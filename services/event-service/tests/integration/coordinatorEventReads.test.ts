import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createSupabaseDeps } from "../../src/supabase";
import { adminClient, hasDb, SEED_PASSWORD, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-156 (docs/specs/coordinator-event-reads.md, migration 59): an event coordinator reads an event, and everything
 * hanging off it, only while the event is assigned to them. Replaces SCRUM-91's "every coordinator reads every
 * non-draft event". Every check signs in as a user, so it goes through the same JWT + publishable-key path as
 * event-service. Fixtures are made with the secret key, named "IT-156-", and removed afterwards.
 */

/** Seeded accounts this suite only reads with: it never assigns to them. */
const EMAILS = {
  coordinatorA: "rachel.tan@connectsphere.example.com",
  coordinatorB: "marcus.lim@connectsphere.example.com",
  venueStaff: "kenneth.wong@connectsphere.example.com",
  technicalSupport: "aaron.koh@connectsphere.example.com",
  attendee: "alicia.fernandez@example.com",
  organiserA: "jason.chua@techconnect.example.com",
  organiserB: "weiling.ong@techconnect.example.com",
};

/** Accounts made for this suite, so its reassignment never changes a seeded Lead's workload. */
const MADE = ["lead", "coordOld", "coordNew"] as const;

const DENIED = "42501";

describe.skipIf(!hasDb)("SCRUM-156 coordinators read only the events assigned to them (migration 59)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const app = hasDb ? createApp(createSupabaseDeps()) : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS | (typeof MADE)[number], Actor>;
  const eventIds: string[] = [];
  const madeUsers: string[] = [];

  let eventA: string; // organiser A, coordinator A, submitted
  let eventB: string; // organiser B, coordinator B, submitted
  let unassigned: string; // organiser A, nobody, submitted
  let unassignedDraft: string; // organiser A, nobody, draft
  let registeredEvent: string; // organiser B, coordinator B, with a session

  async function newAccount(key: (typeof MADE)[number], role: string, lead: Actor | null) {
    const email = `it-156-${key.toLowerCase()}-${randomUUID().slice(0, 8)}@connectsphere.example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(error?.message);
    madeUsers.push(data.user.id);
    const profile = await admin.from("users").insert({
      id: data.user.id,
      role,
      full_name: `IT-156 ${key}`,
      email,
      supervising_lead_id: lead?.userId ?? null,
    });
    if (profile.error) throw new Error(profile.error.message);
    who[key] = await signInAs(email);
  }

  async function newEvent(organiser: Actor, coordinator: Actor | null, status = "submitted"): Promise<string> {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-156-${randomUUID().slice(0, 8)}`,
        organiser_id: organiser.userId,
        assigned_coordinator_id: coordinator?.userId ?? null,
        status,
        is_draft: status === "draft",
        preferred_start_datetime: "2031-09-01T02:00:00Z",
        preferred_end_datetime: "2031-09-01T06:00:00Z",
        expected_attendance: 70,
        submitted_at: "2031-01-01T00:00:00Z",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(data.id as string);
    return data.id as string;
  }

  /** The event's comment, status history, coordinator history, document and change request, arranged with the secret key. */
  async function arrangeHistory(eventId: string, organiser: Actor, coordinator: Actor) {
    const comment = await admin
      .from("event_comments")
      .insert({ event_id: eventId, author_id: coordinator.userId, comment_text: "IT-156 comment" })
      .select("id")
      .single();
    if (comment.error) throw new Error(comment.error.message);
    const rows = await Promise.all([
      admin.from("event_comment_mentions").insert({ comment_id: comment.data.id, user_id: organiser.userId }),
      admin.from("event_status_history").insert({ event_id: eventId, old_status: "submitted", new_status: "under_review", changed_by: coordinator.userId }),
      admin.from("event_coordinator_history").insert({ event_id: eventId, coordinator_id: coordinator.userId, assigned_by: coordinator.userId }),
      admin.from("event_documents").insert({ event_id: eventId, file_name: "IT-156.pdf", file_url: "x" }),
      admin.from("event_change_requests").insert({ event_id: eventId, requested_by: organiser.userId, change_description: "IT-156 change" }),
    ]);
    for (const row of rows) if (row.error) throw new Error(row.error.message);
    return comment.data.id as string;
  }

  /** How many rows of `table` the actor sees for this event; `events` is keyed by id, the rest by event_id. */
  const seen = async (actor: Actor, eventId: string, table = "events") => {
    const column = table === "events" ? "id" : "event_id";
    const { data } = await actor.client.from(table).select(column).eq(column, eventId);
    return (data ?? []).length;
  };

  const RELATED = [
    "event_comments",
    "event_status_history",
    "event_coordinator_history",
    "event_documents",
    "event_change_requests",
    "event_sessions",
  ] as const;

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Array<keyof typeof EMAILS>) who[key] = await signInAs(EMAILS[key]);
    await newAccount("lead", "event_coordinator_lead", null);
    await newAccount("coordOld", "event_coordinator", who.lead);
    await newAccount("coordNew", "event_coordinator", who.lead);

    eventA = await newEvent(who.organiserA, who.coordinatorA);
    eventB = await newEvent(who.organiserB, who.coordinatorB);
    unassigned = await newEvent(who.organiserA, null);
    unassignedDraft = await newEvent(who.organiserA, null, "draft");
    registeredEvent = await newEvent(who.organiserB, who.coordinatorB);

    await arrangeHistory(eventA, who.organiserA, who.coordinatorA);
    const session = await admin.from("event_sessions").insert({
      event_id: eventA,
      session_name: "IT-156 session",
      session_date: "2031-09-01",
      start_time: "09:00",
      end_time: "10:00",
      sequence_no: 1,
    });
    if (session.error) throw new Error(session.error.message);
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds); // cascades comments, history, logs
    if (madeUsers.length > 0) await admin.from("users").update({ supervising_lead_id: null }).in("id", madeUsers);
    for (const id of madeUsers) await admin.auth.admin.deleteUser(id);
  });

  // AC1
  it("SCRUM-156/AC1 156-S1: a coordinator reading events gets the ones assigned to them and none assigned to another", async () => {
    const { data } = await who.coordinatorA.client.from("events").select("id").like("name", "IT-156-%");
    const ids = (data ?? []).map((r) => r.id);
    expect(ids).toContain(eventA);
    expect(ids).not.toContain(eventB);
    expect(ids).not.toContain(registeredEvent);
    expect(ids).not.toContain(unassigned);
    expect(ids).not.toContain(unassignedDraft);

    const { data: other } = await who.coordinatorB.client.from("events").select("id").like("name", "IT-156-%");
    const otherIds = (other ?? []).map((r) => r.id);
    expect(otherIds).toEqual(expect.arrayContaining([eventB, registeredEvent]));
    expect(otherIds).not.toContain(eventA);
  });

  // AC2
  it("SCRUM-156/AC2 156-S2: a coordinator it is not assigned to reads none of the event's comments, history, documents, change requests or sessions", async () => {
    for (const table of RELATED) {
      expect(await seen(who.coordinatorA, eventA, table), `${table} for the assigned coordinator`).toBeGreaterThan(0);
      expect(await seen(who.coordinatorB, eventA, table), `${table} for another coordinator`).toBe(0);
    }
    expect(await seen(who.coordinatorB, eventA)).toBe(0);
    const mentions = (actor: Actor) =>
      actor.client.from("event_comment_mentions").select("id, event_comments!inner(event_id)").eq("event_comments.event_id", eventA);
    expect(((await mentions(who.coordinatorA)).data ?? []).length).toBeGreaterThan(0);
    expect(((await mentions(who.coordinatorB)).data ?? []).length).toBe(0);
  });

  // AC2: through event-service, as the caller (so the database decides what the route can read)
  it("SCRUM-156/AC2 156-S8: opening an event that is not assigned to them is a 404 with no details, in every route that reads it", async () => {
    const as = (actor: Actor) => `cs_session=${actor.token}`;
    const get = (actor: Actor, id: string, path = "") => request(app).get(`/events/${id}${path}`).set("Cookie", as(actor));

    const own = await get(who.coordinatorA, eventA);
    expect(own.status).toBe(200);
    expect(own.body.id).toBe(eventA);

    for (const path of ["", "/outcome", "/mentionable-users"]) {
      const res = await get(who.coordinatorB, eventA, path);
      expect(res.status, `GET /events/:id${path}`).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain("IT-156");
    }
    const comments = await get(who.coordinatorB, eventA, "/comments");
    expect(comments.body.comments).toEqual([]);
    expect(comments.body.can_request_clarification).toBe(false);
    const ownComments = await get(who.coordinatorA, eventA, "/comments");
    expect(ownComments.body.comments.length).toBeGreaterThan(0);

    // AC3 through the route: nobody's event is not a coordinator's, but the Lead opens it from their queue
    expect((await get(who.coordinatorA, unassigned)).status).toBe(404);
    expect((await get(who.lead, unassigned)).status).toBe(200);
  });

  // AC3
  it("SCRUM-156/AC3 156-S3: an unassigned event, submitted or draft, is invisible to every coordinator; a Lead still reads the submitted one", async () => {
    for (const coordinator of [who.coordinatorA, who.coordinatorB, who.coordOld, who.coordNew]) {
      expect(await seen(coordinator, unassigned)).toBe(0);
      expect(await seen(coordinator, unassignedDraft)).toBe(0);
    }
    expect(await seen(who.lead, unassigned)).toBe(1);
    expect(await seen(who.lead, unassignedDraft)).toBe(0);
    expect(await seen(who.organiserA, unassigned)).toBe(1);
    expect(await seen(who.organiserA, unassignedDraft)).toBe(1);
  });

  // AC4
  it("SCRUM-156/AC4 156-S4: after a Lead reassigns an event the new coordinator reads it and its history, and the previous one reads none", async () => {
    const eventId = await newEvent(who.organiserA, who.coordOld, "planning");
    const commentId = await arrangeHistory(eventId, who.organiserA, who.coordOld);
    for (const table of ["events", ...RELATED.filter((t) => t !== "event_sessions")]) {
      expect(await seen(who.coordOld, eventId, table), `${table} before`).toBeGreaterThan(0);
      expect(await seen(who.coordNew, eventId, table), `${table} before, new coordinator`).toBe(0);
    }

    const { error } = await who.lead.client.rpc("lead_reassign_coordinator", {
      p_event_id: eventId,
      p_coordinator_id: who.coordNew.userId,
    });
    expect(error).toBeNull();

    for (const table of ["events", ...RELATED.filter((t) => t !== "event_sessions")]) {
      expect(await seen(who.coordNew, eventId, table), `${table} after, new coordinator`).toBeGreaterThan(0);
      expect(await seen(who.coordOld, eventId, table), `${table} after, previous coordinator`).toBe(0);
    }
    const comment = await who.coordOld.client.from("event_comments").select("id").eq("id", commentId);
    expect(comment.data ?? []).toHaveLength(0);
    // the organiser keeps what they had
    expect(await seen(who.organiserA, eventId)).toBe(1);
    expect(await seen(who.organiserA, eventId, "event_comments")).toBeGreaterThan(0);
  });

  // AC5
  it("SCRUM-156/AC5 156-S5: the assigned coordinator still comments, mentions, changes status and reads history; another coordinator cannot", async () => {
    const eventId = await newEvent(who.organiserA, who.coordinatorA);

    const comment = await who.coordinatorA.client.rpc("post_event_comment", {
      p_event_id: eventId,
      p_body: "IT-156 hello",
      p_parent_comment_id: null,
      p_mentions: [who.organiserA.userId],
      p_clarification_request: false,
    });
    expect(comment.error).toBeNull();

    const status = await who.coordinatorA.client.rpc("change_event_status", {
      p_event_id: eventId,
      p_new_status: "approved",
      p_reason: "IT-156",
    });
    expect(status.error).toBeNull();
    expect(await seen(who.coordinatorA, eventId, "event_status_history")).toBeGreaterThan(0);

    // another coordinator: no comment, no mention, no update, and nothing to read
    const foreign = await who.coordinatorB.client.rpc("post_event_comment", {
      p_event_id: eventId,
      p_body: "IT-156 intruder",
      p_parent_comment_id: null,
      p_mentions: [],
      p_clarification_request: false,
    });
    expect(foreign.error?.code).toBe(DENIED);
    const update = await who.coordinatorB.client.from("events").update({ status: "planning" }).eq("id", eventId).select("id");
    expect(update.data ?? []).toHaveLength(0);
    const rpc = await who.coordinatorB.client.rpc("change_event_status", {
      p_event_id: eventId,
      p_new_status: "planning",
      p_reason: "not mine",
    });
    // the event does not exist as far as they can tell, so the function finds nothing to change
    expect(rpc.data ?? []).toHaveLength(0);
    const { data: row } = await admin.from("events").select("status").eq("id", eventId).single();
    expect(row?.status).toBe("approved");
    const { data: history } = await admin.from("event_status_history").select("changed_by").eq("event_id", eventId);
    expect(history).toEqual([{ changed_by: who.coordinatorA.userId }]);
  });

  // AC6 is covered by the unchanged assertions in eventsRls.test.ts and the other roles' suites; these are the extra checks
  it("SCRUM-156/AC6 156-S7: the organiser, Venue Staff, Technical Support Staff, an attendee and a Lead read no more and no less than before", async () => {
    expect(await seen(who.organiserA, eventA)).toBe(1);
    expect(await seen(who.organiserB, eventA)).toBe(0);
    for (const table of RELATED) {
      expect(await seen(who.organiserA, eventA, table), `${table} for the organiser`).toBeGreaterThan(0);
      expect(await seen(who.organiserB, eventA, table), `${table} for another organiser`).toBe(0);
    }
    for (const other of [who.venueStaff, who.technicalSupport, who.attendee]) {
      expect(await seen(other, eventA)).toBe(0);
    }
    // a Lead reads an assigned event only through a linked coordinator (migration 22): eventA's coordinator is not theirs
    expect(await seen(who.lead, eventA)).toBe(0);
  });
});
