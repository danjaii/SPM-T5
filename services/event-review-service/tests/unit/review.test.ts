import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";

const id = "10000000-0000-4000-8000-000000000001";
const detail = {
  id, organiser_name: "Jason Chua", name: "Community workshop", purpose: "Learn together",
  preferred_start_datetime: "2026-10-01T01:00:00+00:00",
  preferred_end_datetime: "2026-10-01T03:00:00+00:00", expected_attendance: 25,
  layout_preferences: "Classroom", accessibility_requirements: "Step-free access",
  equipment_requirements_notes: "Projector", submitted_at: "2026-09-28T02:00:00+00:00", status: "submitted",
};

// Only the remote HTTP boundary is replaced; routing, auth forwarding and response handling are real.
function app(options: { rows?: unknown[]; authStatus?: number; dbStatus?: number; offline?: boolean } = {}) {
  return createApp({
    url: "https://supabase.test", publishableKey: "sb_publishable_test",
    fetch: async (input, init) => {
      if (options.offline) throw new Error("private infrastructure detail");
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      if (headers.get("apikey") !== "sb_publishable_test" ||
          headers.get("authorization") !== "Bearer valid-token") return new Response("{}", { status: 401 });
      if (url.pathname === "/auth/v1/user") {
        return Response.json({ id: "coordinator" }, { status: options.authStatus ?? 200 });
      }
      if (url.pathname !== "/rest/v1/rpc/review_submitted_requests") return new Response("{}", { status: 500 });
      const body = JSON.parse(String(init?.body));
      if (body.request_id !== null && body.request_id !== id) return new Response("{}", { status: 400 });
      return Response.json(options.rows ?? [detail], { status: options.dbStatus ?? 200 });
    },
  });
}
const signedIn = (application: ReturnType<typeof app>, path = `/review/requests/${id}`) =>
  request(application).get(path).set("Cookie", "cs_session=valid-token");

describe("ER-01 — View Submitted Event Request Details", () => {
  it("AC1/AC2 returns all request details using the caller's credentials", async () => {
    const response = await signedIn(app());
    expect(response.status).toBe(200);
    expect(response.body).toEqual(detail);
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("AC1 provides the submitted requests list", async () => {
    const response = await signedIn(app(), "/review/requests");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([detail]);
  });
  it("AC1 returns an empty list when no requests are visible", async () => {
    expect((await signedIn(app({ rows: [] }), "/review/requests")).body).toEqual([]);
  });
  it("AC3 preserves absent optional values instead of inventing details", async () => {
    const response = await signedIn(app({ rows: [{ ...detail, purpose: null, expected_attendance: 0 }] }));
    expect(response.body.purpose).toBeNull();
    expect(response.body.expected_attendance).toBe(0);
  });
  it("AC4 rejects a missing session", async () => {
    expect((await request(app()).get(`/review/requests/${id}`)).status).toBe(401);
  });
  it("AC4 rejects an expired session", async () => {
    expect((await signedIn(app({ authStatus: 401 }))).status).toBe(401);
  });
  it("AC4 handles malformed cookie encoding as unauthenticated", async () => {
    expect((await request(app()).get("/review/requests").set("Cookie", "cs_session=%ZZ")).status).toBe(401);
  });
  it("AC4 gives the same not-found response for hidden and nonexistent requests", async () => {
    const response = await signedIn(app({ rows: [] }));
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Request not found or access denied." });
  });
  it("rejects invalid request IDs before querying the database", async () => {
    expect((await signedIn(app(), "/review/requests/not-a-uuid")).status).toBe(400);
  });
  it.each([{ dbStatus: 500 }, { offline: true }])("reports an unavailable backend without leaking details: %j", async (options) => {
    const response = await signedIn(app(options));
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "Could not load event requests. Please try again." });
  });
  it("allows credentialed browser reads from the configured web origin", async () => {
    const response = await request(app()).options("/review/requests").set("Origin", "http://localhost:3000");
    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });
  it("does not grant CORS access to another origin", async () => {
    const response = await request(app()).options("/review/requests").set("Origin", "https://other.test");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
