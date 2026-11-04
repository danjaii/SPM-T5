import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD_CHECK_INTERVAL_MS, runHoldExpiryCheck, startHoldExpiryCheck } from "../../src/services/holdExpiryCheck";

// SCRUM-108: the periodic check that writes "expires soon" and "expired" notifications. The database function does the work once per
// hold (it sets a sent flag); this service only calls it on a timer, with a clock it is given.

type Reply = { data: unknown; error: { message: string } | null };
const fakeDb = (replies: Reply[] = [{ data: 0, error: null }]) => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let i = 0;
  return {
    calls,
    db: { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return replies[Math.min(i++, replies.length - 1)]; } },
  };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("SCRUM-108/AC2 the check asks the database to write the due notifications, with the clock it was given", () => {
  it("SCRUM-108/AC2 calls notify_hold_expiries with the injected time and returns how many it wrote", async () => {
    const { db, calls } = fakeDb([{ data: 3, error: null }]);

    const written = await runHoldExpiryCheck(db, () => new Date("2026-11-14T02:00:00.000Z"));

    expect(written).toBe(3);
    expect(calls).toEqual([{ fn: "notify_hold_expiries", args: { p_now: "2026-11-14T02:00:00.000Z" } }]);
  });

  it("SCRUM-108/AC2 throws the database's reason when the call fails", async () => {
    const { db } = fakeDb([{ data: null, error: { message: "boom" } }]);
    await expect(runHoldExpiryCheck(db, () => new Date())).rejects.toThrow("boom");
  });
});

describe("SCRUM-108/AC3 the check runs every minute", () => {
  it("SCRUM-108/AC3 runs once a minute, each time with the clock's time then", async () => {
    const { db, calls } = fakeDb();
    let now = new Date("2026-11-14T02:00:00.000Z");
    const check = startHoldExpiryCheck({ db, now: () => now, log: () => undefined });
    expect(HOLD_CHECK_INTERVAL_MS).toBe(60_000);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(calls).toHaveLength(0);

    now = new Date("2026-11-14T02:01:00.000Z");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls.map((c) => c.args.p_now)).toEqual(["2026-11-14T02:01:00.000Z"]);

    now = new Date("2026-11-14T02:02:00.000Z");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(2);
    check.stop();
  });

  it("SCRUM-108/AC3 stops when told to", async () => {
    const { db, calls } = fakeDb();
    const check = startHoldExpiryCheck({ db, log: () => undefined });
    check.stop();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(calls).toHaveLength(0);
  });

  it("SCRUM-108/AC3 keeps running after a failed check, and says what failed", async () => {
    const { db, calls } = fakeDb([{ data: null, error: { message: "db down" } }, { data: 1, error: null }]);
    const log = vi.fn();
    const check = startHoldExpiryCheck({ db, log });

    await vi.advanceTimersByTimeAsync(120_000);

    expect(calls).toHaveLength(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("failed"), expect.any(Error));
    check.stop();
  });

  it("SCRUM-108/AC3 does not start a check while the last one is still running", async () => {
    let release!: () => void;
    const calls: number[] = [];
    const db = { rpc: () => { calls.push(1); return new Promise<Reply>((resolve) => { release = () => resolve({ data: 0, error: null }); }); } };
    const check = startHoldExpiryCheck({ db, log: () => undefined });

    await vi.advanceTimersByTimeAsync(180_000);
    expect(calls).toHaveLength(1);

    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(2);
    check.stop();
  });
});
