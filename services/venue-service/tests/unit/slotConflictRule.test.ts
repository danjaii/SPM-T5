import { describe, it, expect } from "vitest";
import { sgtToUtc } from "@spm-t5/shared";
import { BookingError } from "../../src/domain/errors";
import { SlotConflictRule } from "../../src/services/slotConflictRule";
import { FakeBookingRepository } from "../support/fakeBookingRepository";

const ORCHID = "venue-orchid-hall";
const LOTUS = "venue-lotus-room";

const period = (date: string, start: string, end: string) => ({
  start: sgtToUtc(date, start),
  end: sgtToUtc(date, end),
});

const newBooking = (eventId: string, venueId: string, p: { start: Date; end: Date }) => ({
  eventId,
  venueId,
  ...p,
  requestedBy: `coordinator-of-${eventId}`,
  snapshot: { eventName: eventId, expectedAttendance: 50, venueRequirements: null, accessibilityNeeds: null },
});

/** "Summit A" holds Orchid Hall on 2026-11-14, 09:00-17:00 in the given DB status. */
function arrange(holderStatus: string) {
  const repo = new FakeBookingRepository();
  const held = period("2026-11-14", "09:00", "17:00");
  repo.seed({
    eventId: "summit-a",
    venueId: ORCHID,
    ...held,
    status: holderStatus,
    requestedBy: "coordinator-a",
    snapshot: { eventName: "Summit A", expectedAttendance: 100, venueRequirements: null, accessibilityNeeds: null },
  });
  return { repo, rule: new SlotConflictRule(repo) };
}

describe("SCRUM-36/AC1 overlapping requests are refused (36-S1)", () => {
  const overlapping = [
    ["13:00", "18:00", "partly overlaps"],
    ["09:00", "17:00", "identical"],
    ["10:00", "12:00", "falls inside"],
    ["08:00", "18:00", "contains the held period"],
    ["16:59", "18:00", "overlaps by one minute"],
  ] as const;

  // The holder is Pending ("requested") and then Approved; legacy tentative/confirmed rows hold too.
  describe.each(["requested", "approved", "tentative", "confirmed"])("holder is %s", (holderStatus) => {
    it.each(overlapping)("%s-%s (%s)", async (start, end) => {
      const { repo, rule } = arrange(holderStatus);
      const requested = period("2026-11-14", start, end);

      await expect(rule.check(ORCHID, requested.start, requested.end)).rejects.toMatchObject({
        code: "SLOT_CONFLICT",
        httpStatus: 409,
        message: "This venue is already held for part of that period.",
      });

      // The data-layer guard refuses it too, and nothing is created.
      await expect(repo.insert(newBooking("summit-b", ORCHID, requested))).rejects.toMatchObject({
        code: "SLOT_CONFLICT",
      });
      expect(repo.rows).toHaveLength(1);
    });
  });
});

describe("SCRUM-36/AC2 non-overlapping requests are permitted (36-S2)", () => {
  const allowed = [
    ["Orchid Hall 17:00-18:00 (starts as the held period ends)", ORCHID, "2026-11-14", "17:00", "18:00"],
    ["Orchid Hall 07:00-09:00 (ends as the held period starts)", ORCHID, "2026-11-14", "07:00", "09:00"],
    ["Orchid Hall on a different date", ORCHID, "2026-11-15", "09:00", "17:00"],
    ["Lotus Room at the same time (different venue)", LOTUS, "2026-11-14", "09:00", "17:00"],
  ] as const;

  it.each(allowed)("%s", async (_name, venueId, date, start, end) => {
    const { repo, rule } = arrange("requested");
    const requested = period(date, start, end);

    await expect(rule.check(venueId, requested.start, requested.end)).resolves.toBeUndefined();
    const created = await repo.insert(newBooking("summit-b", venueId, requested));
    expect(created.status).toBe("requested"); // Pending
    expect(repo.rows).toHaveLength(2);
  });
});

describe("SCRUM-36/AC3 released slots become requestable (36-S3)", () => {
  it.each(["rejected", "withdrawn"])("a %s holder no longer blocks the slot", async (holderStatus) => {
    const { repo, rule } = arrange(holderStatus);
    const same = period("2026-11-14", "09:00", "17:00");

    await expect(rule.check(ORCHID, same.start, same.end)).resolves.toBeUndefined();
    const created = await repo.insert(newBooking("summit-b", ORCHID, same));
    expect(created.status).toBe("requested");
  });
});

describe("SCRUM-36/AC4 simultaneous requests (36-S4, in-memory)", () => {
  // The real concurrency proof is the integration test against Postgres (tests/integration).
  it("exactly one of two parallel overlapping inserts succeeds; the other is SLOT_CONFLICT", async () => {
    const repo = new FakeBookingRepository();
    const rule = new SlotConflictRule(repo);
    const a = period("2026-11-14", "09:00", "17:00");
    const b = period("2026-11-14", "13:00", "18:00");

    // Both pass the friendly pre-check (nothing held yet), then race on insert.
    await Promise.all([rule.check(ORCHID, a.start, a.end), rule.check(ORCHID, b.start, b.end)]);
    const results = await Promise.allSettled([
      repo.insert(newBooking("summit-a", ORCHID, a)),
      repo.insert(newBooking("summit-b", ORCHID, b)),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(BookingError);
    expect(rejected[0].reason).toMatchObject({ code: "SLOT_CONFLICT" });
    expect(repo.rows.filter((r) => r.status === "requested")).toHaveLength(1);
  });
});

describe("SCRUM-36/AC5 the refusal does not expose other events (36-S5)", () => {
  it("the body carries only the code and message, nothing about the holder", async () => {
    const { repo, rule } = arrange("requested");
    const holder = repo.rows[0];
    const requested = period("2026-11-14", "10:00", "12:00");

    const error = await rule.check(ORCHID, requested.start, requested.end).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BookingError);

    const body = (error as BookingError).toBody();
    expect(body).toEqual({
      code: "SLOT_CONFLICT",
      error: "This venue is already held for part of that period.",
    });

    const serialised = JSON.stringify(body);
    for (const secret of ["Summit A", "coordinator-a", holder.id, "summit-a"]) {
      expect(serialised).not.toContain(secret);
    }
  });
});
