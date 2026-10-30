import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MyEventRequestsTable } from "@/components/MyEventRequestsTable";

const row = (over: object) => ({
  id: "e1", name: "Tech Summit", status: "submitted", preferred_start_datetime: null, expected_attendance: null, submitted_at: null, ...over,
});

describe("SCRUM-54/AC1 a draft in My event requests opens the form", () => {
  it("links a draft to the form with that draft loaded", () => {
    render(<MyEventRequestsTable requests={[row({ id: "d1", name: "Half-planned", status: "draft" })]} />);
    expect(screen.getByRole("link", { name: "Half-planned" }).getAttribute("href")).toBe("/events/new?draft=d1");
  });

  it("still links every other request to its event page", () => {
    render(<MyEventRequestsTable requests={[row({ id: "e1" }), row({ id: "e2", name: "Expo", status: "approved" })]} />);
    expect(screen.getByRole("link", { name: "Tech Summit" }).getAttribute("href")).toBe("/events/e1");
    expect(screen.getByRole("link", { name: "Expo" }).getAttribute("href")).toBe("/events/e2");
  });
});
