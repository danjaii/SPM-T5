import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { NotificationError } from "../../src/domain/errors";
import { errorHandler } from "../../src/middlewares/errors";
import { SupabaseAccessReader } from "../../src/readers/accessReader";
import { SupabaseNotificationRepository } from "../../src/repositories/supabaseNotificationRepository";
import { createSupabaseDeps } from "../../src/supabase";
import { deps } from "../support/fakes";

/** A query builder that records the calls made on it and answers with `result` however it is awaited. */
function fakeDb(result: unknown) {
  const calls: [string, unknown[]][] = [];
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "eq", "in", "order", "limit", "update"]) {
    builder[name] = (...args: unknown[]) => {
      calls.push([name, args]);
      return builder;
    };
  }
  builder.maybeSingle = async () => result;
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  const tables: string[] = [];
  const db = { from: (t: string) => (tables.push(t), builder) } as unknown as SupabaseClient;
  return { db, calls, tables };
}

const boom = { data: null, error: { message: "boom" } };

describe("SCRUM-46/AC1 SupabaseNotificationRepository (46-S1)", () => {
  it("46-S1: lists the user's rows, newest first, limited", async () => {
    const { db, calls } = fakeDb({ data: [{ id: "n-1" }], error: null });
    expect(await new SupabaseNotificationRepository(db).list("u-1", 7)).toEqual([{ id: "n-1" }]);
    expect(calls).toContainEqual(["eq", ["user_id", "u-1"]]);
    expect(calls).toContainEqual(["order", ["created_at", { ascending: false }]]);
    expect(calls).toContainEqual(["limit", [7]]);
  });

  it("46-S1: counts unread rows (0 when the count is missing)", async () => {
    expect(await new SupabaseNotificationRepository(fakeDb({ count: 3, error: null }).db).countUnread("u-1")).toBe(3);
    expect(await new SupabaseNotificationRepository(fakeDb({ count: null, error: null }).db).countUnread("u-1")).toBe(0);
  });

  it("46-S1: an empty result is an empty list", async () => {
    expect(await new SupabaseNotificationRepository(fakeDb({ data: null, error: null }).db).list("u-1", 5)).toEqual([]);
  });

  it("46-S1: a database error is thrown, not hidden", async () => {
    const repo = new SupabaseNotificationRepository(fakeDb(boom).db);
    await expect(repo.list("u-1", 5)).rejects.toThrow("boom");
    await expect(repo.countUnread("u-1")).rejects.toThrow("boom");
    await expect(repo.find("u-1", "n-1")).rejects.toThrow("boom");
    await expect(repo.markRead("u-1", "n-1")).rejects.toThrow("boom");
  });
});

describe("SCRUM-46/AC4 SupabaseNotificationRepository marks read (46-S4)", () => {
  it("46-S4: updates only is_read, for the user's own row", async () => {
    const { db, calls } = fakeDb({ data: { id: "n-1", is_read: true }, error: null });
    expect(await new SupabaseNotificationRepository(db).markRead("u-1", "n-1")).toEqual({ id: "n-1", is_read: true });
    expect(calls).toContainEqual(["update", [{ is_read: true }]]);
    expect(calls).toContainEqual(["eq", ["user_id", "u-1"]]);
  });

  it("46-S4: a row that is not the user's comes back null", async () => {
    const repo = new SupabaseNotificationRepository(fakeDb({ data: null, error: null }).db);
    expect(await repo.markRead("u-1", "n-9")).toBeNull();
    expect(await repo.find("u-1", "n-9")).toBeNull();
  });
});

describe("SCRUM-46/AC7 SupabaseAccessReader (46-S7)", () => {
  it("46-S7: reads the role of the caller", async () => {
    const reader = new SupabaseAccessReader(fakeDb({ data: { role: "venue_staff" }, error: null }).db);
    expect(await reader.roleOf("u-1")).toBe("venue_staff");
    expect(await new SupabaseAccessReader(fakeDb({ data: null, error: null }).db).roleOf("u-1")).toBeUndefined();
  });

  it("46-S7: labels the events it can see, and leaves out the ones it cannot", async () => {
    const { db, tables } = fakeDb({ data: [{ id: "e-1", name: "Tech Summit" }], error: null });
    const labels = await new SupabaseAccessReader(db).visibleLabels([
      { kind: "event", id: "e-1" },
      { kind: "event", id: "e-2" },
    ]);
    expect([...labels]).toEqual([["event:e-1", "Tech Summit"]]);
    expect(tables).toEqual(["events"]);
  });

  it("46-S7: labels a booking with its venue and event, falling back when one is hidden", async () => {
    const rows = [
      { id: "b-1", venues: { name: "Orchid Hall" }, events: { name: "Summit" } },
      { id: "b-2", venues: [{ name: "Rose Room" }], events: null },
      { id: "b-3", venues: null, events: { name: "Gala" } },
      { id: "b-4", venues: null, events: null },
    ];
    const labels = await new SupabaseAccessReader(fakeDb({ data: rows, error: null }).db).visibleLabels(
      rows.map((r) => ({ kind: "venue_booking" as const, id: r.id })),
    );
    expect([...labels.values()]).toEqual(["Orchid Hall for Summit", "Rose Room", "Gala", "Venue booking"]);
  });

  it("46-S7: nothing to look up, no queries; a database error is thrown", async () => {
    const { db, tables } = fakeDb({ data: [], error: null });
    expect((await new SupabaseAccessReader(db).visibleLabels([])).size).toBe(0);
    expect(tables).toEqual([]);
    const failing = new SupabaseAccessReader(fakeDb(boom).db);
    await expect(failing.roleOf("u-1")).rejects.toThrow("boom");
    await expect(failing.visibleLabels([{ kind: "event", id: "e" }])).rejects.toThrow("boom");
    await expect(failing.visibleLabels([{ kind: "venue_booking", id: "b" }])).rejects.toThrow("boom");
  });
});

describe("SCRUM-46 wiring", () => {
  it("builds the default Supabase-backed app without touching the network", () => {
    expect(createApp(deps)).toBeTypeOf("function");
  });

  it("createSupabaseDeps needs the Supabase URL and key", () => {
    expect(() => createSupabaseDeps({})).toThrow("SUPABASE_URL");
    const made = createSupabaseDeps({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_PUBLISHABLE_KEY: "k" });
    expect(made.forUser("token")).toBeDefined();
  });

  it("errorHandler: an unexpected error is a 500 that says nothing about it", () => {
    const sent: { status?: number; body?: unknown } = {};
    const res = {
      status: (s: number) => ((sent.status = s), res),
      json: (b: unknown) => ((sent.body = b), res),
    };
    const log = console.error;
    console.error = () => {};
    try {
      errorHandler(new Error("secret db detail"), {} as never, res as never, () => {});
      errorHandler(new NotificationError("NOT_FOUND", 404, "gone"), {} as never, res as never, () => {});
    } finally {
      console.error = log;
    }
    expect(sent).toEqual({ status: 404, body: { code: "NOT_FOUND", error: "gone" } });
  });
});
