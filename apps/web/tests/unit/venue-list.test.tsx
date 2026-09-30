// this testing file is used to check whether the information that we want on the frontend is actually there

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VenueList } from "@/components/VenueList";

// ---------------------------------------------------------------------------
// SCRUM-29 — Venue catalogue page (list)
// ---------------------------------------------------------------------------
describe("SCRUM-29 — Venue catalogue list", () => {
  // AC1 (Scenario 1): each venue is listed with its name, location and maximum capacity
  // test whether on the frontend, we can see name, location, and maximum capacity
  it("lists each venue's name, location and maximum capacity, linking to its detail page", () => {
    render(
      <VenueList
        venues={[
          { id: "v1", name: "Marina Bayview Hall A", address: "10 Bayfront Ave", max_capacity: 300 },
          { id: "v2", name: "Orchard Suite 1", address: "391A Orchard Road", max_capacity: 40 },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "Marina Bayview Hall A" }).getAttribute("href")).toBe("/venues/v1");
    expect(screen.getByText("10 Bayfront Ave")).toBeTruthy();
    expect(screen.getByText("300")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Orchard Suite 1" }).getAttribute("href")).toBe("/venues/v2");
    expect(screen.getByText("391A Orchard Road")).toBeTruthy();
    expect(screen.getByText("40")).toBeTruthy();
  });
  // end of AC1

  // AC5 (Scenario 5): with no venues, an empty-state message is shown rather than an error (or an empty table). this test case is an edge case and we wont likely need it in the real website because we should always be able to show the venues 
  it("shows an empty-state message when there are no venues", () => {
    render(<VenueList venues={[]} />);

    expect(screen.getByText("No venues in the catalogue yet.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
  // end of AC5
});
// end of SCRUM-29
