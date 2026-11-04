import { describe, expect, it } from "vitest";
import { createHoldExpiryDb } from "../../src/supabase";

// SCRUM-108: the check writes notifications for other people, so it uses the service key; without one it does not run.
describe("SCRUM-108/AC2 the check's database connection", () => {
  it("SCRUM-108/AC2 is none when there is no service key, so the service still starts", () => {
    expect(createHoldExpiryDb({ SUPABASE_URL: "http://localhost:54321", SUPABASE_PUBLISHABLE_KEY: "pub" })).toBeUndefined();
  });

  it("SCRUM-108/AC2 is a client with rpc when the URL and service key are set", () => {
    const db = createHoldExpiryDb({ SUPABASE_URL: "http://localhost:54321", SUPABASE_SECRET_KEY: "secret" });
    expect(typeof db?.rpc).toBe("function");
  });
});
