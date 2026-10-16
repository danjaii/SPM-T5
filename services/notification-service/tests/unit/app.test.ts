import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { deps } from "../support/fakes";

// chore (SCRUM-90): notification-service now binds a port, so its container stays up under docker compose.
describe("chore SCRUM-90 notification-service app", () => {
  let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
  let baseUrl: string;

  beforeAll(async () => {
    server = createApp(deps).listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it("reports healthy on GET /health", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "notification-service" });
  });

  it("returns 404 for unknown routes", async () => {
    expect((await fetch(`${baseUrl}/nope`)).status).toBe(404);
  });

  // SCRUM-46: the web app calls this service from the browser, with its cookie
  it("SCRUM-46 answers CORS preflight for the web origin, with credentials and POST", async () => {
    const res = await fetch(`${baseUrl}/notifications/x/read`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:3000" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("SCRUM-46 sends no CORS headers to other origins", async () => {
    const res = await fetch(`${baseUrl}/notifications`, { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
