import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EVENT_STATUSES } from "@spm-t5/shared";

import EventStatusBadge from "@/components/EventStatusBadge";
import { StatusBadge } from "@/components/ui/status-badge";
import { ALL_STATUS_DISPLAYS, BOOKING_STATUS_DISPLAY, EVENT_STATUS_DISPLAY } from "@/lib/status";

describe("SCRUM-120/AC2 StatusBadge shows tone, icon and label", () => {
  for (const { group, key, display } of ALL_STATUS_DISPLAYS) {
    it(`${group} ${key} renders "${display.label}" with an icon in the ${display.tone} tone`, () => {
      const { container } = render(<StatusBadge {...display} />);
      const badge = container.querySelector("[data-slot=badge]") as HTMLElement;
      expect(badge.textContent).toBe(display.label);
      expect(badge.getAttribute("data-tone")).toBe(display.tone);
      expect(screen.getByTestId("status-icon")).toBeTruthy();
      expect(badge.className).toContain(`bg-status-${display.tone}`);
      expect(badge.className).toContain(`text-status-${display.tone}-fg`);
    });
  }

  it("never uses the primary (button) colour for any status", () => {
    for (const { display } of ALL_STATUS_DISPLAYS) {
      const { container, unmount } = render(<StatusBadge {...display} />);
      expect(container.innerHTML).not.toMatch(/bg-primary|text-primary-foreground/);
      unmount();
    }
  });

  it("maps Hold to the info tone and Expired to the danger tone, each with its own icon", () => {
    expect(BOOKING_STATUS_DISPLAY.HOLD).toMatchObject({ tone: "info", icon: "pause", label: "Hold" });
    expect(BOOKING_STATUS_DISPLAY.EXPIRED).toMatchObject({ tone: "danger", icon: "timer-off", label: "Expired" });
  });

  it("renders every event status through EventStatusBadge with its mapped tone", () => {
    for (const status of EVENT_STATUSES) {
      const { container, unmount } = render(<EventStatusBadge status={status} />);
      const badge = container.querySelector("[data-slot=badge]") as HTMLElement;
      expect(badge.getAttribute("data-tone")).toBe(EVENT_STATUS_DISPLAY[status].tone);
      expect(badge.textContent).toBe(EVENT_STATUS_DISPLAY[status].label);
      unmount();
    }
  });

  it("shows an unknown status with a neutral tone and an icon instead of dropping it", () => {
    const { container } = render(<EventStatusBadge status="mystery" />);
    expect(container.querySelector("[data-slot=badge]")?.getAttribute("data-tone")).toBe("neutral");
    expect(screen.getByText("mystery")).toBeTruthy();
    expect(screen.getByTestId("status-icon")).toBeTruthy();
  });
});
