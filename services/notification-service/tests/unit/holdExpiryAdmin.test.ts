import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createHoldExpiryDb } from "../../src/supabase";

// A pretend Supabase library: a real createClient opens a live connection, which needs WebSocket (Node 22+).
// CI's test job runs Node 20, so the real one would fail there (same as equipment-service's supabaseReaders.test.ts).
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ rpc: vi.fn() })) }));

// SCRUM-108: the check writes notifications for other people, so it uses the service key; without one it does not run.
describe("SCRUM-108/AC4, AC5 the check's database connection", () => {
  it("SCRUM-108/AC4, AC5 is none when there is no service key, so the service still starts", () => {
    expect(createHoldExpiryDb({ SUPABASE_URL: "http://localhost:54321", SUPABASE_PUBLISHABLE_KEY: "pub" })).toBeUndefined();
  });

  it("SCRUM-108/AC4, AC5 is a client with rpc when the URL and service key are set", () => {
    const db = createHoldExpiryDb({ SUPABASE_URL: "http://localhost:54321", SUPABASE_SECRET_KEY: "secret" });
    expect(typeof db?.rpc).toBe("function");
    expect(createClient).toHaveBeenCalledWith("http://localhost:54321", "secret", expect.anything());
  });
});
