import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createSupabaseDeps } from "../../src/supabase";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-196: Technical Support Staff open the event of an on-site assignment, read-only, as the SCRUM-20 spec says.
 * Every read signs in as a real user, so row level security (migration 59) decides what they see. Fixtures are made with
 * the secret key, named "IT-196-", and removed afterwards.
 */
const EMAILS = {
  technician: "aaron.koh@connectsphere.example.com",
  coordinator: "rachel.tan@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
};

describe.skipIf(!hasDb)("SCRUM-196 Technical Support Staff open the event of their assignment", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const app = hasDb ? createApp(createSupabaseDeps()) : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];
  let assignedEvent: string;
  let otherEvent: string;

  const as = (actor: Actor) => `cs_session=${actor.token}`;
  const open = (actor: Actor, id: string) => request(app).get(`/events/${id}`).set("Cookie", as(actor));

  async function newEvent(): Promise<string> {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-196-${randomUUID().slice(0, 8)}`,
        organiser_id: who.organiser.userId,
        assigned_coordinator_id: who.coordinator.userId,
        status: "planning",
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

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as (keyof typeof EMAILS)[]) who[key] = await signInAs(EMAILS[key]);
    assignedEvent = await newEvent();
    otherEvent = await newEvent();
    const { error } = await admin.from("technical_staff_assignments").insert({
      event_id: assignedEvent,
      staff_id: who.technician.userId,
      assigned_by: who.coordinator.userId,
      start_datetime: "2031-09-01T02:00:00Z",
      end_datetime: "2031-09-01T06:00:00Z",
    });
    if (error) throw new Error(error.message);
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds); // cascades
  });

  it("SCRUM-196/AC1 opens the event of an assignment, with its details", async () => {
    const res = await open(who.technician, assignedEvent);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: assignedEvent, status: "planning", expected_attendance: 70 });
  });

  it("SCRUM-196/AC2 the event comes with no way to change, review or edit it", async () => {
    const res = await open(who.technician, assignedEvent);

    expect(res.body).toMatchObject({ canChangeStatus: false, canReview: false, canEdit: false, isOrganiser: false, canRequestChange: false });
  });

  it("SCRUM-196/AC2 refuses a status change, and the event stays as it was", async () => {
    const res = await request(app)
      .patch(`/events/${assignedEvent}/status`)
      .set("Cookie", as(who.technician))
      .send({ status: "cancelled", reason: "IT-196" });

    expect(res.status).toBe(403);
    const { data } = await admin.from("events").select("status").eq("id", assignedEvent).single();
    expect(data?.status).toBe("planning");
  });

  it("SCRUM-196/AC3 an event with no technical work is refused as not found", async () => {
    const res = await open(who.technician, otherEvent);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Event not found." });
  });

  it("SCRUM-196/AC4 the coordinator and organiser still open the event, and the coordinator can still change it", async () => {
    const asCoordinator = await open(who.coordinator, assignedEvent);
    const asOrganiser = await open(who.organiser, assignedEvent);

    expect(asCoordinator.status).toBe(200);
    expect(asCoordinator.body).toMatchObject({ canChangeStatus: true, canReview: true, canEdit: true });
    expect(asOrganiser.status).toBe(200);
    expect(asOrganiser.body).toMatchObject({ isOrganiser: true, canChangeStatus: false });
  });
});
