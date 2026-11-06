import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLOSED_EVENT_STATUSES } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import { createSupabaseDeps } from "../../src/supabase";
import { adminClient, hasDb, SEED_PASSWORD, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-189: GET /lead/events against the real database, so RLS (events_select_lead_team, migration 81) decides what a Lead
 * reads. Other files add events while this runs (SCRUM-143), so every check looks only at the events made here: named
 * "IT-189-", dated 2031, held by coordinators made here, and removed afterwards.
 */
const EMAILS = {
  coordinator: "rachel.tan@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
};

type Row = { id: string; name: string; status: string; preferred_start_datetime: string | null; coordinator: { id: string; full_name: string } | null };

describe.skipIf(!hasDb)("SCRUM-189 all active events (GET /lead/events)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const app = hasDb ? createApp(createSupabaseDeps()) : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS | "lead" | "ann" | "bo" | "retired", Actor>;
  const madeUsers: string[] = [];
  const ev = {} as Record<string, string>;

  async function newAccount(key: "lead" | "ann" | "bo" | "retired", role: string, isActive = true) {
    const email = `it-189-${key}-${randomUUID().slice(0, 8)}@connectsphere.example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(error?.message);
    madeUsers.push(data.user.id);
    const profile = await admin.from("users").insert({ id: data.user.id, role, full_name: `IT-189 ${key}`, email, is_active: isActive });
    if (profile.error) throw new Error(profile.error.message);
    who[key] = await signInAs(email);
  }

  async function newEvent(key: string, coordinator: string | null, status: string, start: string) {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-189-${key}`,
        organiser_id: who.organiser.userId,
        assigned_coordinator_id: coordinator,
        status,
        is_draft: status === "draft",
        preferred_start_datetime: start,
        preferred_end_datetime: start.replace("T02", "T06"),
        expected_attendance: 40,
        submitted_at: status === "draft" ? null : "2031-01-01T00:00:00Z",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    ev[key] = data.id as string;
  }

  const listAs = async (actor: Actor) => request(app).get("/lead/events").set("Cookie", `cs_session=${actor.token}`);
  const mine = (rows: Row[]) => rows.filter((r) => Object.values(ev).includes(r.id));

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Array<keyof typeof EMAILS>) who[key] = await signInAs(EMAILS[key]);
    await newAccount("lead", "event_coordinator_lead");
    await newAccount("ann", "event_coordinator");
    await newAccount("bo", "event_coordinator");
    await newAccount("retired", "event_coordinator", false);
    await newEvent("ann-later", who.ann.userId, "planning", "2031-08-01T02:00:00Z");
    await newEvent("bo-sooner", who.bo.userId, "submitted", "2031-07-01T02:00:00Z");
    await newEvent("retired-held", who.retired.userId, "approved", "2031-09-01T02:00:00Z");
    await newEvent("unassigned", null, "submitted", "2031-07-15T02:00:00Z");
    await newEvent("draft", who.ann.userId, "draft", "2031-07-20T02:00:00Z");
    for (const status of CLOSED_EVENT_STATUSES) await newEvent(status, who.ann.userId, status, "2031-07-10T02:00:00Z");
  });

  afterAll(async () => {
    const ids = Object.values(ev);
    if (ids.length > 0) await admin.from("events").delete().in("id", ids);
    for (const id of madeUsers) await admin.auth.admin.deleteUser(id); // cascades to users
  });

  it("SCRUM-189/AC1 lists every active event with its coordinator, earliest first, whoever holds it", async () => {
    const res = await listAs(who.lead);

    expect(res.status).toBe(200);
    const rows = mine(res.body as Row[]);
    expect(rows.map((r) => r.name)).toEqual(["IT-189-bo-sooner", "IT-189-ann-later", "IT-189-retired-held"]);
    expect(rows[0]).toMatchObject({ status: "submitted", coordinator: { id: who.bo.userId, full_name: "IT-189 bo" } });
  });

  it("SCRUM-189/AC2 leaves out closed, draft and unassigned events", async () => {
    const ids = (mine((await listAs(who.lead)).body as Row[])).map((r) => r.id);

    for (const key of ["unassigned", "draft", ...CLOSED_EVENT_STATUSES]) expect(ids).not.toContain(ev[key]);
  });

  it.each(["coordinator", "organiser"] as const)("SCRUM-189/AC5 refuses the list to a %s", async (key) => {
    const res = await listAs(who[key]);

    expect(res.status).toBe(403);
  });
});
