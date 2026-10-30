// SCRUM-97: an expired hold is shown as Expired (AC4), cannot be confirmed (AC5) or extended (AC7), with a message saying a new request is needed

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { VENUE_BOOKING_MESSAGES } from "@spm-t5/shared";
import { toBookingDto } from "../../src/domain/dto";
import type { BookingRecord } from "../../src/domain/types";
import { SupabaseHoldExpiryWriter } from "../../src/readers/holdExpiryWriter";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";

const NOW = new Date("2030-11-01T09:01:00.000Z"); // 17:01 in Singapore
const EXPIRY = new Date("2030-11-01T09:00:00.000Z"); // 17:00 in Singapore
const record = (over: Partial<BookingRecord> = {}): BookingRecord => ({
  id: "b1", eventId: "e1", venueId: "v1", start: new Date("2030-11-14T02:00:00Z"), end: new Date("2030-11-14T04:00:00Z"), status: "requested",
  snapshot: { eventName: "Summit A", expectedAttendance: 100, venueRequirements: null, accessibilityNeeds: null },
  requestedBy: "u1", createdAt: new Date("2030-10-20T00:00:00Z"), reviewedBy: null, reviewedAt: null, reviewNotes: null, withdrawnBy: null, withdrawnAt: null,
  cancelledBy: null, cancelledAt: null, cancellationReason: null, amendsBookingId: null, fromSuggestion: false, suggestion: null, suitability: null,
  suitabilityUnmet: null, suitabilityOverrideReason: null, sentBackChanges: null, sentBackAt: null, replacedByBookingId: null, replacedAt: null,
  holdExpiresAt: EXPIRY, ...over,
}) as BookingRecord;

describe("SCRUM-97/AC4 an expired hold shows status Expired", () => {
  it("is EXPIRED once the expiry has passed, with the expiry time", () => {
    const dto = toBookingDto(record(), NOW);
    expect(dto.status).toBe("EXPIRED");
    expect(dto.holdExpiresAt).toBe(EXPIRY.toISOString());
  });

  it("is still PENDING one minute before the expiry, and at no moment earlier", () => {
    expect(toBookingDto(record(), new Date("2030-11-01T08:59:00.000Z")).status).toBe("PENDING");
    expect(toBookingDto(record(), new Date("2030-11-01T08:59:59.999Z")).status).toBe("PENDING");
  });

  it("is EXPIRED exactly at the expiry", () => {
    expect(toBookingDto(record(), EXPIRY).status).toBe("EXPIRED");
  });

  it("leaves a hold with no expiry pending for ever, with a null expiry", () => {
    const dto = toBookingDto(record({ holdExpiresAt: null }), NOW);
    expect(dto.status).toBe("PENDING");
    expect(dto.holdExpiresAt).toBeNull();
  });

  it.each(["approved", "rejected", "withdrawn", "cancelled"])("never shows a %s booking as expired, whatever its old expiry", (status) => {
    expect(toBookingDto(record({ status }), NOW).status).not.toBe("EXPIRED");
  });
});

describe("SCRUM-97/AC5 and AC7 the database's refusals become 409 HOLD_EXPIRED", () => {
  const message = VENUE_BOOKING_MESSAGES.HOLD_EXPIRED;

  it("has a message that says the venue is no longer reserved and a new request is needed", () => {
    expect(message).toMatch(/expired/i);
    expect(message).toMatch(/new (venue )?request/i);
  });

  it("maps HE003 from set_hold_expiry (extending an expired hold)", async () => {
    const db = { rpc: async () => ({ data: null, error: { code: "HE003", message: "x" } }) } as never;
    await expect(new SupabaseHoldExpiryWriter(db).set("b1", new Date())).rejects.toMatchObject({ code: "HOLD_EXPIRED", httpStatus: 409, message });
  });

  it("maps CS097 from the approve guard (confirming an expired hold)", async () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["update", "eq", "select"]) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: null, error: { code: "CS097", message: "expired" } });
    const repo = new SupabaseBookingRepository({ from: () => chain } as unknown as SupabaseClient);
    await expect(repo.decide("b1", { outcome: "approved" }, "staff", new Date())).rejects.toMatchObject({ code: "HOLD_EXPIRED", httpStatus: 409, message });
  });
});
