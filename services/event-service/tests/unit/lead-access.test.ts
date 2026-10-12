import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { requireLead } from "../../src/middlewares/lead";
import { requireSession } from "../../src/middlewares/session";
import type { SupabaseDeps } from "../../src/supabase";

/**
 * SCRUM-75/AC6 + AC7: every Lead endpoint sits behind requireSession + requireLead. This mounts the pair in front of a
 * stand-in Lead action and calls it directly over HTTP as each role, the way a non-Lead would by typing the API URL.
 */
const USERS: Record<string, string> = {
  "token-lead": "event_coordinator_lead",
  "token-coordinator": "event_coordinator",
  "token-venue": "venue_staff",
  "token-tech": "technical_support_staff",
  "token-organiser": "event_organiser",
  "token-attendee": "attendee",
  "token-safety": "safety_officer",
  "token-norole": "not_a_role",
};

function makeApp() {
  const deps = {
    anon: {
      auth: {
        getUser: async (token: string) =>
          token in USERS || token === "token-noprofile"
            ? { data: { user: { id: `user-${token}` } }, error: null }
            : { data: { user: null }, error: { message: "bad token" } },
      },
    },
    // The caller's own profile row, read as the caller (so RLS applies), as lookUpRole does
    forUser: (token: string) => ({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: USERS[token] ? { role: USERS[token] } : null, error: null }) }),
        }),
      }),
    }),
  } as unknown as SupabaseDeps;

  const action = vi.fn((_req: express.Request, res: express.Response) => res.json({ ok: true }));
  const app = express();
  app.post("/lead/action", requireSession(deps), requireLead(deps), action);
  return { app, action };
}

describe("SCRUM-75 — Lead-only API access", () => {
  // AC6: a Lead reaches the Lead action
  it("SCRUM-75/AC6 lets a Lead through to a Lead action", async () => {
    const { app, action } = makeApp();
    const res = await request(app).post("/lead/action").set("Cookie", "cs_session=token-lead");

    expect(res.status).toBe(200);
    expect(action).toHaveBeenCalledOnce();
  });
  // end of AC6

  // AC7: every other role (and a token with no profile or no real role) is refused before the action runs
  it.each(["token-coordinator", "token-venue", "token-tech", "token-organiser", "token-attendee", "token-safety", "token-norole", "token-noprofile"])(
    "SCRUM-75/AC7 refuses a direct API call by a non-Lead (%s) and never runs the Lead action",
    async (token) => {
      const { app, action } = makeApp();
      const res = await request(app).post("/lead/action").set("Cookie", `cs_session=${token}`);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Only an Event Coordinator Lead can do this." });
      expect(action).not.toHaveBeenCalled();
    },
  );

  it("SCRUM-75/AC7 refuses a caller who is not signed in", async () => {
    const { app, action } = makeApp();
    const res = await request(app).post("/lead/action");

    expect(res.status).toBe(401);
    expect(action).not.toHaveBeenCalled();
  });
  // end of AC7
});
