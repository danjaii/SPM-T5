import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
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

// SCRUM-22 (enables the coordinator review queue UI): GET/POST from the queue and review screens.
describe("SCRUM-22: CORS for the review screens", () => {
  const app = createApp({} as SupabaseDeps);
  const WEB = "http://localhost:3000";

  afterEach(() => {
    delete process.env.WEB_ORIGIN;
  });

  it("answers a GET preflight without needing a session", async () => {
    const res = await request(app).options("/events").set("Origin", WEB).set("Access-Control-Request-Method", "GET");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toContain("GET");
  });

  it("allows POST (approve, reject, comments)", async () => {
    const res = await request(app)
      .options("/events/some-id/approve")
      .set("Origin", WEB)
      .set("Access-Control-Request-Method", "POST");
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("adds the CORS headers to a real response from the web origin", async () => {
    const res = await request(app).get("/events").set("Origin", WEB);
    expect(res.status).toBe(401);
    expect(res.headers["access-control-allow-origin"]).toBe(WEB);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers.vary).toContain("Origin");
  });

  it("takes the allowed origin from WEB_ORIGIN", async () => {
    process.env.WEB_ORIGIN = "https://app.example.com";
    const res = await request(app).options("/events").set("Origin", "https://app.example.com");
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    const old = await request(app).options("/events").set("Origin", WEB);
    expect(old.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

// SCRUM-54/AC2: the draft form re-saves with PUT /events/drafts/:id from the web app; without PUT in the preflight answer the
// browser blocks the request and the form says it could not reach the server.
describe("SCRUM-54/AC2: CORS for re-saving a draft", () => {
  const app = createApp({} as SupabaseDeps);
  const WEB = "http://localhost:3000";

  it("allows a PUT preflight for /events/drafts/:id from the web origin, with the login cookie", async () => {
    const res = await request(app)
      .options("/events/drafts/3f2c9c1e-0000-4000-8000-000000000001")
      .set("Origin", WEB)
      .set("Access-Control-Request-Method", "PUT")
      .set("Access-Control-Request-Headers", "content-type");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(WEB);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect((res.headers["access-control-allow-methods"] as string).split(",")).toContain("PUT");
    expect(res.headers["access-control-allow-headers"]).toMatch(/content-type/i);
  });

  it("still refuses another website the PUT", async () => {
    const res = await request(app)
      .options("/events/drafts/3f2c9c1e-0000-4000-8000-000000000001")
      .set("Origin", "https://evil.example.com")
      .set("Access-Control-Request-Method", "PUT");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-methods"]).toBeUndefined();
  });
});
