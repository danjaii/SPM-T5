import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, it, expect } from "vitest";
import { BookingError } from "../../src/domain/errors";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";

interface Reply {
  data?: Record<string, unknown> | null;
  error?: { code: string; message: string } | null;
}

const ROW = {
  id: "booking-1",
  event_id: "event-1",
  venue_id: "venue-1",
  event_start_datetime: "2030-11-14T01:00:00.000Z",
  event_end_datetime: "2030-11-14T09:00:00.000Z",
  status: "requested",
  requested_by: "user-1",
  created_at: "2030-01-01T00:00:00.000Z",
  from_suggestion: false,
  snapshot_event_name: "Summit B",
  snapshot_expected_attendance: 50,
};

/** A stub of from().insert().select().single() that plays back the given replies in order. */
function stubDb(replies: Reply[]) {
  const calls = { insert: 0 };
  const db = {
    from: () => ({
      insert: () => {
        calls.insert++;
        return {
          select: () => ({
            single: async () => replies.shift() ?? { data: null, error: { code: "XX000", message: "no reply" } },
          }),
        };
      },
    }),
  } as unknown as SupabaseClient;
  return { repo: new SupabaseBookingRepository(db), calls };
}

const input = {
  eventId: "event-1",
  venueId: "venue-1",
  start: new Date("2030-11-14T01:00:00.000Z"),
  end: new Date("2030-11-14T09:00:00.000Z"),
  requestedBy: "user-1",
  snapshot: { eventName: "Summit B", expectedAttendance: 50, venueRequirements: null, accessibilityNeeds: null },
};

const pg = (code: string, message = "boom") => ({ error: { code, message } });

describe("SupabaseBookingRepository.insert: constraint translation", () => {
  it("36-S1: an exclusion violation (23P01) is SLOT_CONFLICT", async () => {
    const { repo } = stubDb([pg("23P01", 'conflicting key value violates exclusion constraint "venue_bookings_no_overlap"')]);
    await expect(repo.insert(input)).rejects.toMatchObject({ code: "SLOT_CONFLICT", httpStatus: 409 });
  });

  it("32-S6: the one-active-per-event index is ACTIVE_REQUEST_EXISTS", async () => {
    const { repo } = stubDb([pg("23505", 'duplicate key value violates unique constraint "venue_bookings_one_active_per_event"')]);
    await expect(repo.insert(input)).rejects.toMatchObject({ code: "ACTIVE_REQUEST_EXISTS" });
  });

  it("59-S3: the one-suggestion-accept index is SUGGESTION_ALREADY_USED", async () => {
    const { repo } = stubDb([pg("23505", 'duplicate key value violates unique constraint "venue_bookings_one_suggestion_accept"')]);
    await expect(repo.insert(input)).rejects.toMatchObject({ code: "SUGGESTION_ALREADY_USED" });
  });

  it("36-S5: never leaks the database message, but keeps it as the cause for server logs", async () => {
    const secret = "Key (venue_id)=(v-9) conflicts with existing key held by event Summit A";
    const { repo } = stubDb([pg("XX000", secret)]);
    const error = await repo.insert(input).catch((e: unknown) => e as Error);

    expect(error).not.toBeInstanceOf(BookingError);
    expect(error.message).toBe("Could not save the venue booking request.");
    expect(error.message).not.toContain("Summit A");
    expect((error.cause as { message: string }).message).toBe(secret);
  });

  it("maps a successful insert to a BookingRecord", async () => {
    const { repo } = stubDb([{ data: ROW }]);
    const record = await repo.insert(input);
    expect(record).toMatchObject({ id: "booking-1", status: "requested", eventId: "event-1", venueId: "venue-1" });
    expect(record.snapshot.eventName).toBe("Summit B");
  });
});

describe("SCRUM-36/AC4 simultaneous requests: deadlock victim (36-S4)", () => {
  // Observed against real Postgres: ~7% of head-on races abort the loser with 40P01 (deadlock detected).
  // It is safe to retry: by then the winner has committed, so the retry gets the accurate refusal.
  it("retries a deadlock victim and reports the real reason (SLOT_CONFLICT)", async () => {
    const { repo, calls } = stubDb([pg("40P01", "deadlock detected"), pg("23P01")]);
    await expect(repo.insert(input)).rejects.toMatchObject({ code: "SLOT_CONFLICT", httpStatus: 409 });
    expect(calls.insert).toBe(2);
  });

  it("succeeds if the retry goes through", async () => {
    const { repo, calls } = stubDb([pg("40P01", "deadlock detected"), { data: ROW }]);
    await expect(repo.insert(input)).resolves.toMatchObject({ id: "booking-1" });
    expect(calls.insert).toBe(2);
  });

  it("gives up after 3 attempts with a generic error rather than looping", async () => {
    const { repo, calls } = stubDb([pg("40P01"), pg("40P01"), pg("40P01"), { data: ROW }]);
    const error = await repo.insert(input).catch((e: unknown) => e as Error);
    expect(error).not.toBeInstanceOf(BookingError);
    expect(error.message).toBe("Could not save the venue booking request.");
    expect(calls.insert).toBe(3);
  });
});

describe("SupabaseBookingRepository.hasHold", () => {
  const rpcDb = (reply: { data: unknown; error: unknown }) => {
    const calls: unknown[][] = [];
    const db = { rpc: async (...args: unknown[]) => (calls.push(args), reply) } as unknown as SupabaseClient;
    return { repo: new SupabaseBookingRepository(db), calls };
  };
  const start = new Date("2030-11-14T01:00:00.000Z");
  const end = new Date("2030-11-14T09:00:00.000Z");

  it("asks venue_slot_is_held, so RLS cannot hide the holder from the pre-check", async () => {
    const held = rpcDb({ data: true, error: null });
    expect(await held.repo.hasHold("v", start, end)).toBe(true);
    expect(held.calls[0]).toEqual([
      "venue_slot_is_held",
      { p_venue_id: "v", p_start: start.toISOString(), p_end: end.toISOString() },
    ]);
    expect(await rpcDb({ data: false, error: null }).repo.hasHold("v", start, end)).toBe(false);
  });

  it("fails with a generic error if the lookup fails", async () => {
    const { repo } = rpcDb({ data: null, error: { code: "XX000", message: "secret" } });
    await expect(repo.hasHold("v", start, end)).rejects.toThrow("Could not check the venue's availability.");
  });
});
