import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

// The web app calls auth-service straight from the browser, so it needs CORS with credentials.
// SCRUM-22 (enables the coordinator review queue UI, which reads the role from /auth/me)
const app = createApp({} as SupabaseDeps);
const WEB = "http://localhost:3000";

afterEach(() => {
  delete process.env.WEB_ORIGIN;
});

describe("SCRUM-22: auth-service CORS", () => {
  it("answers a preflight from the web origin without needing a session", async () => {
    const res = await request(app)
      .options("/auth/me")
      .set("Origin", WEB)
      .set("Access-Control-Request-Method", "GET");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(WEB);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("adds the CORS headers to a real response from the web origin", async () => {
    const res = await request(app).get("/auth/me").set("Origin", WEB);
    expect(res.status).toBe(401);
    expect(res.headers["access-control-allow-origin"]).toBe(WEB);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers.vary).toContain("Origin");
  });

  it("does not allow any other origin, and never uses a wildcard", async () => {
    const res = await request(app).options("/auth/me").set("Origin", "http://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("takes the allowed origin from WEB_ORIGIN", async () => {
    process.env.WEB_ORIGIN = "https://app.example.com";
    const res = await request(app).options("/auth/me").set("Origin", "https://app.example.com");
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    const old = await request(app).options("/auth/me").set("Origin", WEB);
    expect(old.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
