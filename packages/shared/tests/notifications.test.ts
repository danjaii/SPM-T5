import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_TYPES,
  NO_ACCESS_LABEL,
  notificationHref,
  parseNotificationLimit,
} from "../src/notifications";

describe("SCRUM-46/AC5 notificationHref maps a target to its page (46-S5)", () => {
  it("46-S5: an event opens its event page", () => {
    expect(notificationHref("event", "e-1", "event_coordinator")).toBe("/events/e-1");
  });

  it("46-S5: a venue booking opens the booking page, or the queue for venue staff", () => {
    expect(notificationHref("venue_booking", "b-1", "event_coordinator")).toBe("/venue-bookings/b-1");
    expect(notificationHref("venue_booking", "b-1")).toBe("/venue-bookings/b-1");
    expect(notificationHref("venue_booking", "b-1", "venue_staff")).toBe("/booking-queue/b-1");
  });
});

describe("SCRUM-46/AC2 the known notification types (46-S2)", () => {
  it("46-S2: lists the seeded types and the booking flag type", () => {
    expect(NOTIFICATION_TYPES).toEqual([
      "event_submitted",
      "coordinator_assigned",
      "event_confirmed",
      "registration_opened",
      "venue_booking_flagged",
    ]);
  });
});

describe("SCRUM-46/AC7 the restricted label (46-S7)", () => {
  it("46-S7: is the agreed wording", () => {
    expect(NO_ACCESS_LABEL).toBe("You no longer have access to this item");
  });
});

describe("SCRUM-46/AC1 parseNotificationLimit (46-S1)", () => {
  it.each([
    [undefined, 50],
    ["", 50],
    ["abc", 50],
    ["0", 50],
    ["-3", 50],
    ["2.5", 50],
    ["10", 10],
    ["100", 100],
    ["500", 100],
  ])("46-S1: %s becomes %i", (raw, expected) => {
    expect(parseNotificationLimit(raw)).toBe(expected);
  });
});
