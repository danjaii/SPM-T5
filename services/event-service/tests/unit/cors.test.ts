import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

// The web app (http://localhost:3000) is a different origin from event-service, so the browser only lets
// its pages call event-service if event-service says so. Needed by the SCRUM-8 status page.
describe("Browser access from the web app (CORS)", () => {
  const app = createApp({} as SupabaseDeps); // these requests never reach the database

  it("allows the web app to send PATCH requests with the login cookie", async () => {
    // Before a PATCH, the browser first asks permission with an OPTIONS request (a "preflight").
    const res = await request(app)
      .options("/events/some-id/status")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "PATCH");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["access-control-allow-methods"]).toContain("PATCH");
  });

  it("does not grant access to other websites", async () => {
    const res = await request(app)
      .options("/events/some-id/status")
      .set("Origin", "https://evil.example.com")
      .set("Access-Control-Request-Method", "PATCH");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
