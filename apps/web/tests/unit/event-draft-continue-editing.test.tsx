// SCRUM-54/AC1: opening a draft from its event page leads back into the form. Only the organiser who owns a draft sees the button.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventRequestDetails } from "@/components/EventRequestDetails";
import type { EventDetailView } from "@/lib/events";

const EVENT: EventDetailView = {
  id: "evt-1",
  name: "SMUX Council Meeting",
  status: "draft",
  canChangeStatus: false,
  canReview: false,
  isOrganiser: true,
  purpose: null,
  preferred_start_datetime: null,
  preferred_end_datetime: null,
  expected_attendance: null,
  preferred_layout_name: null,
  accessibility_requirements: null,
  equipment_requirements_notes: null,
  submitted_at: null,
  updated_at: "2031-03-04T05:06:07.000Z",
  organiser_name: "Jason Chua",
  point_of_contact_name: null,
  description: null,
};

describe("SCRUM-54/AC1 Continue editing on the event page", () => {
  it("links the draft's organiser to the form with the draft opened", () => {
    render(<EventRequestDetails event={EVENT} />);
    expect(screen.getByRole("link", { name: "Continue editing" }).getAttribute("href")).toBe("/events/new?draft=evt-1");
  });

  it("is not shown for a submitted event", () => {
    render(<EventRequestDetails event={{ ...EVENT, status: "submitted", submitted_at: "2031-03-04T05:06:07.000Z" }} />);
    expect(screen.queryByRole("link", { name: "Continue editing" })).toBeNull();
  });

  it("is not shown to anyone but the organiser", () => {
    render(<EventRequestDetails event={{ ...EVENT, isOrganiser: false, canChangeStatus: true }} />);
    expect(screen.queryByRole("link", { name: "Continue editing" })).toBeNull();
  });
});
