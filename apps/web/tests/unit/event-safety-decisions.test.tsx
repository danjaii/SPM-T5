// SCRUM-100 — the event's coordinator and organiser see the Safety Officer's requested changes

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EventSafetyDecisions } from "@/components/EventSafetyDecisions";

describe("SCRUM-100/AC7 view requested changes", () => {
  it("SCRUM-100/AC7 shows who requested the changes, when, and what needs to change", () => {
    render(
      <EventSafetyDecisions
        decisions={[{ decision: "changes_requested", reason: "Move the stage clear of fire exit B", officer_name: "Farah Ismail", decided_at: "2031-06-01T02:00:00Z" }]}
      />,
    );

    const section = within(screen.getByRole("region", { name: "Safety check" }));
    expect(section.getByText("Changes Requested by Farah Ismail on 2031-06-01 10:00")).toBeTruthy();
    expect(section.getByText("Move the stage clear of fire exit B")).toBeTruthy();
  });

  it("SCRUM-100/AC7 says so when none were requested", () => {
    render(<EventSafetyDecisions decisions={[]} />);

    expect(screen.getByText("No safety decision has been made on this event yet.")).toBeTruthy();
  });

  it("SCRUM-100/AC7 leaves the section out when the viewer may not see them", () => {
    const { container } = render(<EventSafetyDecisions decisions={null} />);

    expect(container.innerHTML).toBe("");
  });
});

describe("SCRUM-100/AC8 view the safety decision", () => {
  it("SCRUM-100/AC8 shows an approval with the Safety Officer, date and time, and comments", () => {
    render(
      <EventSafetyDecisions
        decisions={[{ decision: "approved", reason: "Exits clear, PA well placed", officer_name: "Farah Ismail", decided_at: "2031-06-01T02:00:00Z" }]}
      />,
    );

    const section = within(screen.getByRole("region", { name: "Safety check" }));
    expect(section.getByText("Safety Approved by Farah Ismail on 2031-06-01 10:00")).toBeTruthy();
    expect(section.getByText("Exits clear, PA well placed")).toBeTruthy();
  });
});

describe("SCRUM-100/AC9 an approval that no longer applies", () => {
  it("SCRUM-100/AC9 tells the coordinator and organiser the approval no longer applies, and since when", () => {
    render(
      <EventSafetyDecisions
        decisions={[
          {
            decision: "approved",
            reason: null,
            officer_name: "Farah Ismail",
            decided_at: "2031-06-01T02:00:00Z",
            revoked_at: "2031-06-03T02:00:00Z",
          },
        ]}
      />,
    );

    const section = within(screen.getByRole("region", { name: "Safety check" }));
    expect(section.getByText("Safety Approved by Farah Ismail on 2031-06-01 10:00")).toBeTruthy();
    expect(section.getByText("No longer applies: an important change was made on 2031-06-03 10:00.")).toBeTruthy();
  });
});
