import express from "express";
import request from "supertest";
import { describe, it, expect } from "vitest";
import { createApp } from "../../src/app";
import { bookingError, forbidden } from "../../src/domain/errors";
import { asyncHandler, errorHandler } from "../../src/middlewares/errors";
import { requireSession, type SessionUser } from "../../src/middlewares/session";
import type { SupabaseDeps } from "../../src/supabase";

/** Only auth.getUser is used by the session middleware: "good-token" belongs to user-1. */
const deps = {
  anon: {
    auth: {
      getUser: async (token: string) =>
        token === "good-token" ? { data: { user: { id: "user-1" } } } : { data: { user: null } },
    },
  },
  forUser: () => {
    throw new Error("not used here");
  },
} as unknown as SupabaseDeps;

describe("venue-service app (scaffold)", () => {
  it("answers CORS preflight for the web origin, including POST", async () => {
    const res = await request(createApp(deps))
      .options("/venue-bookings")
      .set("Origin", "http://localhost:3000");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("sends no CORS headers to other origins", async () => {
    const res = await request(createApp(deps)).options("/venue-bookings").set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("requireSession (authentication, DR2)", () => {
  const app = express();
  app.get("/whoami", requireSession(deps), (_req, res) => res.json(res.locals.user as SessionUser));

  it("401 with no cookie", async () => {
    expect((await request(app).get("/whoami")).status).toBe(401);
  });

  it("401 with a token Supabase does not recognise", async () => {
    const res = await request(app).get("/whoami").set("Cookie", "cs_session=stale");
    expect(res.status).toBe(401);
  });

  it("puts the caller on res.locals.user for a valid session", async () => {
    const res = await request(app).get("/whoami").set("Cookie", "cs_session=good-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "user-1", token: "good-token" });
  });
});

describe("errorHandler (DR12, 36-S5 over HTTP)", () => {
  const app = express();
  app.get("/conflict", asyncHandler(async () => { throw bookingError("SLOT_CONFLICT"); }));
  app.get("/forbidden", asyncHandler(async () => { throw forbidden(); }));
  app.get("/boom", asyncHandler(async () => { throw new Error('duplicate key value violates "event-secret-123"'); }));
  app.use(errorHandler);

  it("renders a BookingError as its status with only the code and message", async () => {
    const res = await request(app).get("/conflict");
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      code: "SLOT_CONFLICT",
      error: "This venue is already held for part of that period.",
    });
  });

  it("renders 403 without protected data", async () => {
    const res = await request(app).get("/forbidden");
    expect(res.status).toBe(403);
    expect(Object.keys(res.body).sort()).toEqual(["code", "error"]);
  });

  it("hides the message of an unexpected error behind a generic 500", async () => {
    const res = await request(app).get("/boom");
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("event-secret-123");
  });
});
