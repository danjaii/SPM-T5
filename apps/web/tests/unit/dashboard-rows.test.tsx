// SCRUM-151 — clickable things look clickable: the rows of a dashboard table, e.g. the coordinator's Events I coordinate

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { DashboardView, type DashboardData } from "@/components/DashboardView";

const data: DashboardData = {
  user: { fullName: "Rachel Tan", email: "rachel@example.com", role: "event_coordinator" },
  sections: [
    {
      title: "Events I coordinate",
      columns: [
        { key: "name", label: "Event" },
        { key: "status", label: "Status", linkKey: "statusHref", statusKey: "statusKey" },
        { key: "attendance", label: "Expected attendance" },
      ],
      rows: [
        { name: "Tech Summit", status: "under review", statusKey: "under_review", statusHref: "/events/evt-1", attendance: 120 },
        { name: "Expo", status: "planning", statusKey: "planning", statusHref: "/events/evt-2", attendance: 80 },
      ],
    },
    {
      title: "My venue booking requests",
      columns: [{ key: "event", label: "Event" }, { key: "status", label: "Status" }],
      rows: [{ event: "Tech Summit", status: "requested" }],
    },
  ],
};

beforeEach(() => router.push.mockClear());

/** The event rows of the section headed `title`, without its header row. */
const rowsOf = (title: string) =>
  within(screen.getByRole("heading", { name: title }).closest("section") as HTMLElement).getAllByRole("row").slice(1);

// jsdom does not apply Tailwind's styles, so the hover and focus checks look for the classes that set them.
describe("SCRUM-151/AC2 a dashboard row with a link shows it can be clicked", () => {
  it("SCRUM-151/AC2 highlights the whole row on hover and shows the hand cursor", () => {
    render(<DashboardView data={data} />);

    for (const row of rowsOf("Events I coordinate")) {
      expect(row.className).toContain("hover:bg-muted");
      expect(row.className).toContain("cursor-pointer");
    }
  });

  it("SCRUM-151/AC2 leaves a row with nothing to open plain, and the header row too", () => {
    render(<DashboardView data={data} />);

    const plain = [rowsOf("My venue booking requests")[0], screen.getAllByRole("row")[0]];
    for (const row of plain) {
      expect(row.className).not.toContain("hover:bg-muted");
      expect(row.className).not.toContain("cursor-pointer");
    }
  });
});

describe("SCRUM-151/AC3 open an event from anywhere on its dashboard row", () => {
  it.each(["Tech Summit", "120"])("SCRUM-151/AC3 opens the event's page when %s on the row is clicked", (text) => {
    render(<DashboardView data={data} />);

    fireEvent.click(within(rowsOf("Events I coordinate")[0]).getByText(text));

    expect(router.push).toHaveBeenCalledWith("/events/evt-1");
  });

  it("SCRUM-151/AC3 opens the event of the row that was clicked, not another", () => {
    render(<DashboardView data={data} />);

    fireEvent.click(within(rowsOf("Events I coordinate")[1]).getByText("Expo"));

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/events/evt-2");
  });

  it("SCRUM-151/AC3 leaves a click on the status to its link, so the page is not opened twice", () => {
    render(<DashboardView data={data} />);

    fireEvent.click(within(rowsOf("Events I coordinate")[0]).getByRole("link"));

    expect(router.push).not.toHaveBeenCalled();
  });

  it("SCRUM-151/AC3 opens nothing from a row with nothing to open", () => {
    render(<DashboardView data={data} />);

    fireEvent.click(within(rowsOf("My venue booking requests")[0]).getByText("requested"));

    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("SCRUM-151/AC4 open an event from the dashboard with the keyboard", () => {
  it("SCRUM-151/AC4 keeps the status as a link, shows a focus ring on it and adds no extra Tab stop", () => {
    render(<DashboardView data={data} />);

    const row = rowsOf("Events I coordinate")[0];
    const link = within(row).getByRole("link");
    expect(link.getAttribute("href")).toBe("/events/evt-1");
    expect(link.className).toContain("focus-visible:ring-2");
    expect(row.getAttribute("tabindex")).toBeNull();
  });

  it("SCRUM-151/AC4 highlights the whole row while its link has keyboard focus", () => {
    render(<DashboardView data={data} />);

    expect(rowsOf("Events I coordinate")[0].className).toContain("has-focus-visible:bg-muted");
  });
});
