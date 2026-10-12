import { render, screen } from "@testing-library/react";
import { describe, it } from "vitest";

import EventStatusBadge from "@/components/EventStatusBadge";

// ---------------------------------------------------------------------------
// SCRUM-24/AC4 — Persist status
// ---------------------------------------------------------------------------
describe("SCRUM-24/AC4 — Persist status", () => {
  it('displays "Approved" when the event status is approved', () => {
    render(<EventStatusBadge status="approved" />);
    screen.getByText(/approved/i);
  });

  it('displays "Rejected" when the event status is rejected', () => {
    render(<EventStatusBadge status="rejected" />);
    screen.getByText(/rejected/i);
  });

  it('displays "Submitted" when the event status is submitted', () => {
    render(<EventStatusBadge status="submitted" />);
    screen.getByText(/submitted/i);
  });

  it('displays "Under Review" when the event status is under_review', () => {
    render(<EventStatusBadge status="under_review" />);
    screen.getByText(/under review/i);
  });
});
