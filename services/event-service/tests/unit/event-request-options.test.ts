import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

// A tiny fake: one signed-in user and a room_layouts table, enough for GET /events/request-options.
function fake(layouts: { id: string; name: string }[] | null, error = false) {
  return {
    anon: {
      auth: {
        getUser: async (token: string) =>
          token === "good" ? { data: { user: { id: "u1" } }, error: null } : { data: { user: null }, error: { message: "bad" } },
      },
    },
    forUser: () => ({
      from: () => ({ select: () => ({ order: async () => (error ? { data: null, error: { message: "db" } } : { data: layouts, error: null }) }) }),
    }),
  } as unknown as SupabaseDeps;
}

describe("SCRUM-123/AC2 request form options", () => {
  it("lists the room layouts for a signed-in user", async () => {
    const layouts = [{ id: "l1", name: "Classroom" }];
    const res = await request(createApp(fake(layouts))).get("/events/request-options").set("Cookie", "cs_session=good");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ roomLayouts: layouts });
  });

  it("refuses a visitor who is not signed in", async () => {
    const res = await request(createApp(fake([]))).get("/events/request-options");
    expect(res.status).toBe(401);
  });

  it("answers 500 when the layouts cannot be read", async () => {
    const res = await request(createApp(fake(null, true))).get("/events/request-options").set("Cookie", "cs_session=good");
    expect(res.status).toBe(500);
  });
});
