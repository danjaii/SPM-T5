import request from "supertest";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

// The web app calls event-service straight from the browser, so it needs CORS with credentials.
// SCRUM-22 (enables the coordinator review queue UI)
const app = createApp({} as SupabaseDeps);
const WEB = "http://localhost:3000";

afterEach(() => {
  delete process.env.WEB_ORIGIN;
});
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["access-control-allow-methods"]).toContain("PATCH");
  });

describe("SCRUM-22: event-service CORS", () => {
  it("answers a preflight from the web origin without needing a session", async () => {
    const res = await request(app)
      .options("/events")
      .set("Origin", WEB)
      .set("Access-Control-Request-Method", "GET");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(WEB);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["access-control-allow-methods"]).toContain("GET");
  });

  it("allows the web app to send PATCH requests with the login cookie", async () => {
    const res = await request(app)
      .options("/events/some-id/status")
      .set("Origin", WEB)
      .set("Access-Control-Request-Method", "PATCH");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(WEB);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["access-control-allow-methods"]).toContain("PATCH");
  });

  it("adds the CORS headers to a real response from the web origin", async () => {
    const res = await request(app).get("/events").set("Origin", WEB);
    expect(res.status).toBe(401);
    expect(res.headers["access-control-allow-origin"]).toBe(WEB);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers.vary).toContain("Origin");
  });

  it("does not allow any other origin, and never uses a wildcard", async () => {
    const res = await request(app)
      .options("/events")
      .set("Origin", "http://evil.example");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("takes the allowed origin from WEB_ORIGIN", async () => {
    process.env.WEB_ORIGIN = "https://app.example.com";
    const res = await request(app)
      .options("/events")
      .set("Origin", "https://app.example.com");

    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");

    const old = await request(app)
      .options("/events")
      .set("Origin", WEB);

    expect(old.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
  });
});
