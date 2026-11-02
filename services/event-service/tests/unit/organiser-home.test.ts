import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

/** SCRUM-159: GET /events/my-requests/home hands organiser_home() to the page as the signed-in user, and maps its failures. */
function createFake(rpc: (name: string) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>) {
  const forUser = vi.fn((_token: string) => ({ rpc }));
  const deps = {
    anon: {
      auth: {
        getUser: async (token: string) =>
          token === "good" ? { data: { user: { id: "organiser-1" } }, error: null } : { data: { user: null }, error: { message: "bad" } },
      },
    },
    forUser,
  } as unknown as SupabaseDeps;
  return { deps, forUser };
}

const home = (deps: SupabaseDeps, cookie = "cs_session=good") => request(createApp(deps)).get("/events/my-requests/home").set("Cookie", cookie);

describe("SCRUM-159 organiser home (GET /events/my-requests/home)", () => {
  it("SCRUM-159/AC1 returns what organiser_home() gives, read as the caller so the database decides whose events", async () => {
    const rows = [{ id: "evt-1", name: "Tech Summit" }];
    const rpc = vi.fn(async () => ({ data: rows, error: null }));
    const { deps, forUser } = createFake(rpc);

    const res = await home(deps);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
    expect(rpc).toHaveBeenCalledWith("organiser_home");
    expect(forUser).toHaveBeenCalledWith("good");
  });

  it("SCRUM-159/AC4 returns an empty list when the organiser has no events", async () => {
    const res = await home(createFake(async () => ({ data: null, error: null })).deps);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("SCRUM-159/AC1 answers 403 when the caller is not an organiser", async () => {
    const res = await home(createFake(async () => ({ data: null, error: { code: "42501", message: "Only an Event Organiser can do this" } })).deps);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not allowed/);
  });

  it("SCRUM-159/AC1 answers 500 with a plain message when the read fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await home(createFake(async () => ({ data: null, error: { message: "boom" } })).deps);
    spy.mockRestore();

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("We couldn't load your events. Please try again.");
  });

  it("SCRUM-159/AC1 answers 401 without a session", async () => {
    const res = await request(createApp(createFake(async () => ({ data: [], error: null })).deps)).get("/events/my-requests/home");

    expect(res.status).toBe(401);
  });
});
