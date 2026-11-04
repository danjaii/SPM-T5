// SCRUM-108/AC2, AC3, AC5: the booking's own warning window reaches the list (the coordinator's venue bookings), so the screen can use it

import { describe, expect, it } from "vitest";
import { toBookingDto, toBookingListItem } from "../../src/domain/dto";
import type { BookingRecord } from "../../src/domain/types";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";

const record = (over: Partial<BookingRecord> = {}): BookingRecord => ({
  id: "b1", eventId: "e1", venueId: "v1", start: new Date("2030-11-14T02:00:00Z"), end: new Date("2030-11-14T04:00:00Z"), status: "requested",
  snapshot: { eventName: "Summit A", expectedAttendance: 100, venueRequirements: null, accessibilityNeeds: null },
  requestedBy: "u1", createdAt: new Date("2030-10-20T00:00:00Z"), reviewedBy: null, reviewedAt: null, reviewNotes: null, withdrawnBy: null, withdrawnAt: null,
  cancelledBy: null, cancelledAt: null, cancellationReason: null, amendsBookingId: null, fromSuggestion: false, suggestion: null, suitability: null,
  suitabilityUnmet: null, suitabilityOverrideReason: null, sentBackChanges: null, sentBackAt: null, replacedByBookingId: null, replacedAt: null,
  holdExpiresAt: new Date("2030-11-10T00:00:00Z"), ...over,
}) as BookingRecord;

describe("SCRUM-108/AC2, AC3, AC5 each hold carries its own warning window", () => {
  it("SCRUM-108/AC2, AC3, AC5 puts the minutes on the list row and on the detail", () => {
    expect(toBookingListItem(record({ holdWarningMinutes: 480 }), "Orchid Hall").holdWarningMinutes).toBe(480);
    expect(toBookingDto(record({ holdWarningMinutes: 480 })).holdWarningMinutes).toBe(480);
  });

  it("SCRUM-108/AC2, AC3, AC5 leaves the field out when the record has none, so older answers keep their shape", () => {
    expect(toBookingListItem(record(), "Orchid Hall")).not.toHaveProperty("holdWarningMinutes");
    expect(toBookingDto(record())).not.toHaveProperty("holdWarningMinutes");
  });

  it("SCRUM-108/AC2, AC3, AC5 reads hold_warning_minutes from the row and asks the database for the column", async () => {
    const asked: string[] = [];
    const row = { id: "b1", event_id: "e1", venue_id: "v1", status: "requested", event_start_datetime: "2030-11-14T02:00:00Z", event_end_datetime: "2030-11-14T04:00:00Z",
      event_name_snapshot: "Summit A", created_at: "2030-10-20T00:00:00Z", hold_warning_minutes: 90 };
    const db = { from: () => ({ select: (cols: string) => { asked.push(cols); return { eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }; } }) };
    const found = await new SupabaseBookingRepository(db as never).getById("b1");
    expect(found?.holdWarningMinutes).toBe(90);
    expect(asked[0]).toContain("hold_warning_minutes");
  });
});
