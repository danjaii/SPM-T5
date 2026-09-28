import request from "supertest";
import { expect, it } from "vitest";
import { createApp } from "../../src/app";

it("ER-01/AC4 rejects a forged session cookie instead of trusting its presence", async () => {
  const app = createApp({
    url: "https://supabase.test",
    publishableKey: "sb_publishable_test",
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      // Replace only the remote identity provider, not the authentication middleware.
      expect(String(input)).toBe("https://supabase.test/auth/v1/user");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer forged-token");
      expect(new Headers(init?.headers).get("apikey")).toBe("sb_publishable_test");
      return Response.json({ message: "Invalid JWT" }, { status: 401 });
    },
  });
  const response = await request(app)
    .get("/review/requests/10000000-0000-4000-8000-000000000001")
    .set("Cookie", "cs_session=forged-token");

  expect(response.status).toBe(401);
  expect(response.body).toEqual({ error: "Please sign in to view event requests." });
});

it("ER-01/AC4 passes the verified identity to the next handler without granting request permissions", async () => {
  const app = createApp({
    url: "https://supabase.test",
    publishableKey: "sb_publishable_test",
    fetch: async () => Response.json({ id: "verified-user" }),
  });
  // A test-only downstream handler proves the guard does not simply reject every caller.
  app.get("/review/requests", (_req, res) => res.json({ userId: res.locals.userId }));

  const response = await request(app).get("/review/requests")
    .set("Cookie", "cs_session=valid-token");

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ userId: "verified-user" });
});
