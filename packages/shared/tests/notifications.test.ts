import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_TYPES,
  NO_ACCESS_LABEL,
  notificationHref,
  notificationRequiresAction,
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
      // SCRUM-20: on-site technical support assignments
      "technical_assignment_assigned",
      "technical_assignment_changed",
      "technical_assignment_cancelled",
      // SCRUM-47: written by migration 44
      "event_approved",
      "event_rejected",
      "comment_mention",
      "comment_reply",
      "safety_approved",
      "safety_rejected",
      "safety_changes_requested",
      "clarification_requested",
      "clarification_answered",
      "coordinator_reassigned",
    ]);
  });
});

describe("SCRUM-46/AC7 the restricted label (46-S7)", () => {
  it("46-S7: is the agreed wording", () => {
    expect(NO_ACCESS_LABEL).toBe("You no longer have access to this item");
  });
});

describe("SCRUM-47/AC11 whether a notification needs the reader to act (47-S11)", () => {
  it.each([
    ["coordinator_assigned", true],
    ["comment_mention", true],
    ["event_approved", false],
    ["event_rejected", false],
    ["comment_reply", false],
    ["something_new", false],
    ["safety_changes_requested", true], // 47-S12
    ["safety_rejected", false],
    ["clarification_requested", true], // 47-S2
    ["clarification_answered", true], // 47-S3
    ["coordinator_reassigned", false], // SCRUM-126/AC3: information only
  ])("47-S11: %s → %s", (type, expected) => {
    expect(notificationRequiresAction(type)).toBe(expected);
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

describe("SCRUM-174/AC6 the cancellation notification type", () => {
  it("174-S9: knows event_cancelled, written by migration 63", () => {
    expect(NOTIFICATION_TYPES).toContain("event_cancelled");
  });

  it("174-S9: does not ask the reader to act: the event is over, and the reason is in the message", () => {
    expect(notificationRequiresAction("event_cancelled")).toBe(false);
  });
});
