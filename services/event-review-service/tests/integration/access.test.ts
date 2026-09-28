import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";

let admin: Client;
let database: Client;
let container: string | undefined;
const databaseName = `review_test_${process.pid}_${Date.now()}`;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const eventId = uid(100);
const migrations = resolve(import.meta.dirname, "../../../../supabase/migrations");

beforeAll(async () => {
  let connectionString = process.env.REVIEW_TEST_DATABASE_URL;
  if (!connectionString) {
    // Isolated disposable Postgres, never the application's hosted Supabase project.
    container = `spm-review-test-${process.pid}-${Date.now()}`;
    execFileSync("docker", ["run", "--rm", "-d", "--name", container,
      "-e", "POSTGRES_PASSWORD=review-test", "-p", "127.0.0.1::5432", "postgres:15-alpine"], { stdio: "pipe" });
    const mapping = execFileSync("docker", ["port", container, "5432/tcp"], { encoding: "utf8" }).trim();
    connectionString = `postgresql://postgres:review-test@127.0.0.1:${mapping.split(":").at(-1)}/postgres`;
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    admin = new Client({ connectionString });
    try { await admin.connect(); break; }
    catch (error) {
      await admin.end();
      if (attempt === 59) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  database = new Client({ connectionString: url.toString() });
  await database.connect();
  await database.query(`
    DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, anon;
  `);
  for (const file of readdirSync(migrations).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
    await database.query(readFileSync(resolve(migrations, file), "utf8"));
  }
  const roles = ["event_coordinator", "event_coordinator", "event_organiser", "event_organiser", "attendee", "event_coordinator"];
  for (let i = 0; i < roles.length; i++) {
    await database.query("INSERT INTO auth.users VALUES ($1)", [uid(i + 1)]);
    await database.query("INSERT INTO users(id, role, full_name, email, is_active) VALUES ($1, $2, $3, $4, $5)",
      [uid(i + 1), roles[i], i === 2 ? "Jason Chua" : `User ${i + 1}`, `user${i + 1}@test.example`, i !== 5]);
  }
  await database.query(`
    INSERT INTO room_layouts(id, name) VALUES ($1, 'Classroom');
    `, [uid(200)]);
  await database.query(`
    INSERT INTO events(id, name, organiser_id, assigned_coordinator_id, status, is_draft,
      purpose, expected_attendance, preferred_room_layout_id, submitted_at,
      preferred_start_datetime, preferred_end_datetime, accessibility_requirements, equipment_requirements_notes)
    VALUES ($1, 'Community workshop', $2, $3, 'submitted', false,
      'Learn together', 25, $4, '2026-09-28T02:00:00Z',
      '2026-10-01T01:00:00Z', '2026-10-01T03:00:00Z', 'Step-free access', 'Projector');
  `, [eventId, uid(3), uid(1), uid(200)]);
  await database.query(`
    INSERT INTO events(id, name, organiser_id, assigned_coordinator_id, status)
    VALUES ($1, 'Draft', $3, $4, 'draft'), ($2, 'Other assignment', $3, $5, 'submitted');
  `, [uid(101), uid(102), uid(3), uid(1), uid(2)]);
  await database.query(`
    INSERT INTO events(id, name, organiser_id, assigned_coordinator_id, status)
    VALUES ($1, 'Inactive assignment', $3, $4, 'submitted'),
           ($2, 'Wrong role assignment', $3, $5, 'submitted');
  `, [uid(103), uid(104), uid(3), uid(6), uid(5)]);
}, 120_000);

afterAll(async () => {
  await database?.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
  if (container) execFileSync("docker", ["rm", "-f", container], { stdio: "pipe" });
}, 30_000);

async function asUser(userId: string, sql: string, values: unknown[] = []) {
  await database.query("BEGIN");
  try {
    await database.query("SET LOCAL ROLE authenticated");
    await database.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    return (await database.query(sql, values)).rows;
  } finally {
    await database.query("ROLLBACK");
  }
}

// Only Supabase's HTTP transport is replaced. The Express app and PostgreSQL
// query/policies are real, so an incorrect policy leaks rows through this test.
function databaseBackedApp() {
  return createApp({
    url: "https://supabase.test", publishableKey: "sb_publishable_test",
    fetch: async (input, init) => {
      const userId = new Headers(init?.headers).get("Authorization")?.slice("Bearer ".length);
      if (!userId) return Response.json({}, { status: 401 });
      const path = new URL(String(input)).pathname;
      if (path === "/auth/v1/user") return Response.json({ id: userId });
      if (path !== "/rest/v1/rpc/review_submitted_requests") return Response.json({}, { status: 500 });
      const { request_id } = JSON.parse(String(init?.body));
      const rows = await asUser(userId, "SELECT * FROM review_submitted_requests($1)", [request_id]);
      return Response.json(rows);
    },
  });
}

describe("ER-01/AC4 service with real database permissions", () => {
  it("lets the assigned active coordinator pass the request access check", async () => {
    const response = await request(databaseBackedApp()).get(`/review/requests/${eventId}`)
      .set("Cookie", `cs_session=${uid(1)}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: eventId });
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it.each([[2, 100], [3, 100], [4, 100], [5, 104], [6, 103]])(
    "denies user %s access to request %s without exposing its contents", async (user, event) => {
      const response = await request(databaseBackedApp()).get(`/review/requests/${uid(event)}`)
        .set("Cookie", `cs_session=${uid(user)}`);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Request not found or access denied." });
      expect(response.headers["cache-control"]).toBe("no-store");
    },
  );
  it("does not reveal whether a denied request exists", async () => {
    const app = databaseBackedApp();
    const denied = await request(app).get(`/review/requests/${eventId}`).set("Cookie", `cs_session=${uid(2)}`);
    const absent = await request(app).get(`/review/requests/${uid(999)}`).set("Cookie", `cs_session=${uid(2)}`);
    expect(absent.status).toBe(404);
    expect(absent.body).toEqual(denied.body);
  });
});

describe("ER-01 real Postgres permissions and request projection", () => {
  it("AC4 denies an unassigned coordinator even through a direct table read", async () => {
    expect(await asUser(uid(2), "SELECT id FROM events WHERE id = $1", [eventId])).toEqual([]);
  });
  it("AC4 retains direct read access for the assigned active coordinator", async () => {
    expect(await asUser(uid(1), "SELECT id FROM events WHERE id = $1", [eventId])).toEqual([{ id: eventId }]);
  });
  it("AC4 denies an inactive coordinator even when assigned", async () => {
    expect(await asUser(uid(6), "SELECT id FROM events WHERE id = $1", [uid(103)])).toEqual([]);
  });
  it.each([4, 5])("AC4 denies unrelated request reads to user %s", async (user) => {
    expect(await asUser(uid(user), "SELECT id FROM events WHERE id = $1", [eventId])).toEqual([]);
  });
  it("AC4 assignment alone does not give an attendee coordinator permissions", async () => {
    expect(await asUser(uid(5), "SELECT id FROM events WHERE id = $1", [uid(104)])).toEqual([]);
  });
  it("AC4 denies database reads without a caller identity", async () => {
    expect(await asUser("", "SELECT id FROM events WHERE id = $1", [eventId])).toEqual([]);
  });
  it("AC1/AC2 returns the assigned submitted request with all required details", async () => {
    const rows = await asUser(uid(1), "SELECT * FROM review_submitted_requests($1)", [eventId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: eventId, organiser_name: "Jason Chua", name: "Community workshop",
      purpose: "Learn together", expected_attendance: 25, layout_preferences: "Classroom",
      accessibility_requirements: "Step-free access", equipment_requirements_notes: "Projector", status: "submitted",
    });
    expect(rows[0].preferred_start_datetime.toISOString()).toBe("2026-10-01T01:00:00.000Z");
    expect(rows[0].preferred_end_datetime.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(rows[0].submitted_at.toISOString()).toBe("2026-09-28T02:00:00.000Z");
  });
  it("AC1 excludes drafts and requests assigned to someone else from the list", async () => {
    expect((await asUser(uid(1), "SELECT * FROM review_submitted_requests()")).map((row) => row.id)).toEqual([eventId]);
  });
  it.each([2, 3, 4, 5, 6])("AC4 denies the review projection to unauthorised user %s", async (user) => {
    expect(await asUser(uid(user), "SELECT * FROM review_submitted_requests($1)", [eventId])).toEqual([]);
  });
  it("AC3 preserves missing optional information and zero attendance", async () => {
    const rows = await asUser(uid(2), "SELECT * FROM review_submitted_requests($1)", [uid(102)]);
    expect(rows[0]).toMatchObject({ purpose: null, expected_attendance: null, layout_preferences: null });
  });
  it("AC4 prevents assignment tampering to gain access", async () => {
    expect(await asUser(uid(2), "UPDATE events SET assigned_coordinator_id = $1 WHERE id = $2 RETURNING id", [uid(2), eventId])).toEqual([]);
    expect(await asUser(uid(2), "SELECT id FROM events WHERE id = $1", [eventId])).toEqual([]);
  });
  it("AC4 prevents changing another user's profile", async () => {
    expect(await asUser(uid(2), "UPDATE users SET full_name = 'Forged' WHERE id = $1 RETURNING id", [uid(3)])).toEqual([]);
    expect((await database.query("SELECT full_name FROM users WHERE id = $1", [uid(3)])).rows[0].full_name).toBe("Jason Chua");
  });
  it("AC4 prevents deleting and replacing a profile to change permissions", async () => {
    expect(await asUser(uid(4), "DELETE FROM users WHERE id = $1 RETURNING id", [uid(4)])).toEqual([]);
  });
  it("AC4 prevents creating a forged privileged profile", async () => {
    await database.query("INSERT INTO auth.users VALUES ($1)", [uid(7)]);
    await expect(asUser(uid(7), "INSERT INTO users(id, role, full_name, email) VALUES ($1, 'event_coordinator', 'Forged', 'forged@test.example')", [uid(7)]))
      .rejects.toMatchObject({ code: "42501" });
  });
  it("keeps the organiser's own event accessible outside the coordinator review projection", async () => {
    expect(await asUser(uid(3), "SELECT id FROM events WHERE id = $1", [eventId])).toEqual([{ id: eventId }]);
  });
});
