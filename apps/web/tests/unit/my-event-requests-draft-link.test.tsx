import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MyEventRequestsTable } from "@/components/MyEventRequestsTable";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push }) }));

const row = (over: object) => ({
  id: "e1", name: "Tech Summit", status: "submitted", preferred_start_datetime: null, expected_attendance: null, submitted_at: null, ...over,
});

describe("SCRUM-54/AC1 a draft in My event requests opens the form", () => {
  beforeEach(() => push.mockClear());

  it("links a draft to the form with that draft loaded", () => {
    render(<MyEventRequestsTable requests={[row({ id: "d1", name: "Half-planned", status: "draft" })]} />);
    expect(screen.getByRole("link", { name: "Half-planned" }).getAttribute("href")).toBe("/events/new?draft=d1");
  });

  it("still links every other request to its event page", () => {
    render(<MyEventRequestsTable requests={[row({ id: "e1" }), row({ id: "e2", name: "Expo", status: "approved" })]} />);
    expect(screen.getByRole("link", { name: "Tech Summit" }).getAttribute("href")).toBe("/events/e1");
    expect(screen.getByRole("link", { name: "Expo" }).getAttribute("href")).toBe("/events/e2");
  });

  // SCRUM-159/AC2 made the whole row a link: a draft's row must go where its name goes, not to the event page
  it("opens the form from a click anywhere on a draft's row, and the event page from any other row", () => {
    render(<MyEventRequestsTable requests={[row({ id: "d1", name: "Half-planned", status: "draft" }), row({ id: "e2", name: "Expo", status: "approved" })]} />);

    fireEvent.click(screen.getAllByText("—")[0]);
    expect(push).toHaveBeenLastCalledWith("/events/new?draft=d1");

    fireEvent.click(screen.getByText("Approved"));
    expect(push).toHaveBeenLastCalledWith("/events/e2");
  });
});
