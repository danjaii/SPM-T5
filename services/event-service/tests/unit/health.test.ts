import request from "supertest";
import { describe, it, expect } from "vitest";
import { createApp } from "../../src/app";
import { healthCheck } from "../../src/index";
import type { SupabaseDeps } from "../../src/supabase";

describe("event-service health check", () => {
  it("reports ok status", () => {
    expect(healthCheck()).toEqual({ status: "ok", service: "event-service" });
  });

  it("SCRUM-94/AC1: answers GET /health with 200 and no session", async () => {
    const res = await request(createApp({} as SupabaseDeps)).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", service: "event-service" });
  });
});
