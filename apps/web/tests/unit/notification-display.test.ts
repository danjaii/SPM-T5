// SCRUM-174 — the cancellation notification in the bell and on the Notifications page

import { Bell, XCircle } from "lucide-react";
import { describe, expect, it } from "vitest";

import { notificationDisplay } from "@/lib/notificationDisplay";

describe("SCRUM-174/AC6 how a cancellation notification looks", () => {
  it("174-S9: shows a cancelled event with a cross in the danger tone, like a rejection, not the plain fallback bell", () => {
    expect(notificationDisplay("event_cancelled")).toEqual({ icon: XCircle, tone: "danger" });
    expect(notificationDisplay("event_cancelled").icon).not.toBe(Bell);
  });
});
