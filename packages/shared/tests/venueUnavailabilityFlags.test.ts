import { describe, expect, it } from "vitest";
import { sgtToUtc } from "../src/venueBooking";
import { describeFlag, type FlagDto } from "../src/venueBookingFlags";
import {
  FLAGGED_BOOKING_NOTIFICATION_TITLE,
  bookedPeriodText,
  bookingsFlaggedMessage,
  flaggedBookingMessage,
  notificationReasonLabel,
  unavailabilityFlagText,
  unavailabilityPeriodText,
} from "../src/venueUnavailability";

const at = (date: string, time: string) => sgtToUtc(date, time);

// the story's example: TechConf 2026 at Orchid Hall 14 Nov 09:00-17:00, block 14 Nov 08:00 to 16 Nov 18:00
const JIRA = {
  eventName: "TechConf 2026",
  venueName: "Orchid Hall",
  bookingStart: at("2026-11-14", "09:00"),
  bookingEnd: at("2026-11-14", "17:00"),
  blockStart: at("2026-11-14", "08:00"),
  blockEnd: at("2026-11-16", "18:00"),
  reason: "maintenance",
};

describe("SCRUM-106/AC2 the notification wording (106-S2)", () => {
  it("106-S2: the title keeps the en dash of the flag label", () => {
    expect(FLAGGED_BOOKING_NOTIFICATION_TITLE).toBe("Venue unavailable – alternative needed");
  });

  it("106-S2: names the event, venue, booked period, block period and reason", () => {
    expect(flaggedBookingMessage(JIRA)).toBe(
      "TechConf 2026: your booking for Orchid Hall on 14 Nov 09:00 to 17:00 is affected. " +
        "Orchid Hall is unavailable from 14 Nov 08:00 to 16 Nov 18:00 (Maintenance). Request a replacement venue.",
    );
  });

  it("106-S2: a booking that spans days shows both dates; one that stays in a day shows its end time only", () => {
    expect(bookedPeriodText(at("2026-11-14", "09:00"), at("2026-11-14", "17:00"))).toBe("14 Nov 09:00 to 17:00");
    expect(bookedPeriodText(at("2026-11-14", "09:00"), at("2026-11-15", "17:00"))).toBe("14 Nov 09:00 to 15 Nov 17:00");
  });

  it("106-S2: the reason is worded as Venue Staff chose it, and an unknown one reads Other", () => {
    expect(notificationReasonLabel("safety")).toBe("Safety concern");
    expect(notificationReasonLabel("equipment_failure")).toBe("Equipment failure");
    expect(notificationReasonLabel("internal_activity")).toBe("Internal activity");
    expect(notificationReasonLabel("party")).toBe("Other");
    expect(unavailabilityPeriodText(JIRA.blockStart, JIRA.blockEnd)).toBe("14 Nov 08:00 to 16 Nov 18:00");
  });
});

describe("SCRUM-106/AC1 the flag a coordinator sees (106-S1)", () => {
  const block = { startDate: "2026-11-14", startTime: "08:00", endDate: "2026-11-16", endTime: "18:00", reason: "maintenance", reasonLabel: "Maintenance" };
  const flag: FlagDto = {
    id: "f1",
    kind: "venue_unavailable",
    label: "Venue unavailable – alternative needed",
    createdAt: "2026-11-01T00:00:00.000Z",
    otherPeriod: null,
    unavailability: block,
  };

  it("106-S1: the banner text gives the block's period and reason, with the venue's name when it is known", () => {
    expect(unavailabilityFlagText(block, "Orchid Hall")).toBe("Orchid Hall is unavailable from 14 Nov 08:00 to 16 Nov 18:00 (Maintenance)");
    expect(unavailabilityFlagText(block)).toBe("This venue is unavailable from 14 Nov 08:00 to 16 Nov 18:00 (Maintenance)");
  });

  it("106-S1: describeFlag puts the label first, then the block, in words and not colour alone", () => {
    expect(describeFlag(flag, "Orchid Hall")).toBe(
      "Venue unavailable – alternative needed: Orchid Hall is unavailable from 14 Nov 08:00 to 16 Nov 18:00 (Maintenance)",
    );
  });

  it("106-S1: a buffer conflict is described as before", () => {
    expect(
      describeFlag({ kind: "buffer_conflict", label: "Buffer conflict", otherPeriod: { date: "2026-11-14", startTime: "12:30", endTime: "14:00" } }),
    ).toBe("Buffer conflict: another booking at this venue, 12:30 to 14:00 on 14 Nov");
  });
});

describe("SCRUM-106 what Venue Staff are told after saving a block (open question 5)", () => {
  it("106-S6: no bookings affected", () => {
    expect(bookingsFlaggedMessage(0)).toBe("No existing bookings are affected.");
  });

  it("106-S5: one, or several, bookings affected", () => {
    expect(bookingsFlaggedMessage(1)).toBe("1 booking affected; its coordinator has been notified.");
    expect(bookingsFlaggedMessage(3)).toBe("3 bookings affected; their coordinators have been notified.");
  });
});
