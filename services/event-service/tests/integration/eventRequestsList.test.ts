import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createSupabaseDeps } from "../../src/supabase";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-198: GET /events behind the coordinator's Event requests page, against the real database. Fixtures are made with
 * the secret key, named "IT-198-", and removed afterwards. Every check looks only at this suite's own events, because
 * other test files add events while this one runs.
 */
const EMAILS = {
  coordinator: "rachel.tan@connectsphere.example.com",
  otherCoordinator: "marcus.lim@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
};

describe.skipIf(!hasDb)("SCRUM-198 the coordinator's Event requests list", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const app = hasDb ? createApp(createSupabaseDeps()) : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];
  let submitted: string;
  let planning: string;
  let approved: string;
  let otherCoordinators: string;

  async function newEvent(status: string, coordinator: Actor): Promise<string> {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-198-${randomUUID().slice(0, 8)}`,
        organiser_id: who.organiser.userId,
        assigned_coordinator_id: coordinator.userId,
        status,
        expected_attendance: 70,
        submitted_at: "2031-01-01T00:00:00Z",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(data.id as string);
    return data.id as string;
  }

  /** The ids this suite made that the coordinator's list includes. */
  const listed = async (query: string) => {
    const res = await request(app).get(`/events?${query}`).set("Cookie", `cs_session=${who.coordinator.token}`);
    expect(res.status).toBe(200);
    return (res.body as { id: string }[]).map((e) => e.id).filter((id) => eventIds.includes(id));
  };

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as (keyof typeof EMAILS)[]) who[key] = await signInAs(EMAILS[key]);
    submitted = await newEvent("submitted", who.coordinator);
    planning = await newEvent("planning", who.coordinator);
    approved = await newEvent("approved", who.coordinator);
    otherCoordinators = await newEvent("planning", who.otherCoordinator);
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds); // cascades
  });

  it("SCRUM-198/AC1 every status lists the coordinator's requests, whatever their status", async () => {
    const ids = await listed("status=submitted&status=approved&status=planning");
    expect(ids).toEqual(expect.arrayContaining([submitted, planning, approved]));
  });

  it("SCRUM-198/AC2 several statuses list only requests with those statuses", async () => {
    const ids = await listed("status=submitted&status=approved");
    expect(ids).toEqual(expect.arrayContaining([submitted, approved]));
    expect(ids).not.toContain(planning);
  });

  it("SCRUM-198/AC2 one status lists only requests with that status", async () => {
    const ids = await listed("status=planning");
    expect(ids).toContain(planning);
    expect(ids).not.toContain(submitted);
    expect(ids).not.toContain(approved);
  });

  it("SCRUM-198/AC5 a request assigned to another coordinator is not listed", async () => {
    expect(await listed("status=submitted&status=approved&status=planning")).not.toContain(otherCoordinators);
  });
});
