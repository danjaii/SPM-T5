import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));

import Loading from "@/app/venues/loading";
import DetailLoading from "@/app/venues/[id]/loading";
import { VenueDetail, type VenueDetails } from "@/components/VenueDetail";
import { VenueList } from "@/components/VenueList";

// SCRUM-129 (Jira): the venue list and venue detail, redesigned with shadcn cards and theme tokens.
const venue = (extra: Partial<VenueDetails> = {}): VenueDetails => ({
  id: "orchid", name: "Orchid Hall", address: "Level 3", description: null, max_capacity: 150,
  operating_hours_start: "07:00:00", operating_hours_end: "22:00:00", is_accessible: true, accessibility_notes: "Step-free access, Hearing loop",
  layouts: [{ name: "Theatre", max_capacity: 150 }], facilities: ["Projector"], setup_minutes: 30, turnaround_minutes: 45,
  can_edit_timing: false, can_mark_unavailable: false, unavailability: [],
  ...extra,
});

describe("SCRUM-129/AC1 setup and turnaround show next to capacity", () => {
  it("SCRUM-129/AC1 the capacity, setup and turnaround facts are in one list, in that order", () => {
    render(<VenueDetail venue={venue()} />);
    const terms = screen.getAllByRole("term").map((t) => t.textContent);
    expect(terms.slice(0, 3)).toEqual(["Maximum capacity", "Setup time", "Turnaround time"]);
    expect(screen.getByText("Setup time").nextElementSibling?.textContent).toBe("30 minutes");
    expect(screen.getByText("Turnaround time").nextElementSibling?.textContent).toBe("45 minutes");
  });

  it("SCRUM-129/AC1 shows each layout's capacity, the facilities and each accessibility feature", () => {
    render(<VenueDetail venue={venue()} />);
    expect(screen.getByText("Theatre").previousElementSibling?.textContent).toBe("150");
    expect(screen.getByText("Projector")).toBeTruthy();
    expect(screen.getByText("Step-free access")).toBeTruthy();
    expect(screen.getByText("Hearing loop")).toBeTruthy();
  });

  it("SCRUM-129/AC6 the status is a badge with an icon and a label: Available, or Venue unavailable during a block", () => {
    const { unmount } = render(<VenueDetail venue={venue()} />);
    expect(screen.getByText("Available")).toBeTruthy();
    expect(screen.getAllByTestId("status-icon")).toHaveLength(1);
    unmount();

    const now = Date.now();
    render(
      <VenueDetail
        venue={venue({
          unavailability: [{
            id: "b", start: new Date(now - 3_600_000).toISOString(), end: new Date(now + 3_600_000).toISOString(), startDate: "", startTime: "",
            endDate: "", endTime: "", reason: "maintenance", reasonLabel: "Maintenance", recordedAt: new Date(now).toISOString(),
          }],
        })}
      />,
    );
    expect(screen.getByText("Venue unavailable")).toBeTruthy();
  });
});

describe("SCRUM-129/AC2 Venue Staff edit and save with a confirmation", () => {
  it("SCRUM-129/AC2 Venue Staff see Edit venue and Mark unavailable; Edit venue opens the form with the current times", () => {
    render(<VenueDetail venue={venue({ can_edit_timing: true, can_mark_unavailable: true })} />);
    expect(screen.getByRole("button", { name: "Mark unavailable" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit venue" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((screen.getByLabelText("Setup time (minutes)") as HTMLInputElement).value).toBe("30");
    expect(screen.getByRole("button", { name: "Save times" })).toBeTruthy();
  });
});

describe("SCRUM-129/AC3 everyone else sees the venue read-only", () => {
  it("SCRUM-129/AC3 no Edit venue, no Mark unavailable and no form, but the venue's facts are all there", () => {
    render(<VenueDetail venue={venue()} />);
    expect(screen.queryByRole("button", { name: "Edit venue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark unavailable" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save times" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Orchid Hall" })).toBeTruthy();
    expect(screen.getByText("30 minutes")).toBeTruthy();
  });
});

describe("SCRUM-129/AC10 empty, loading and error states", () => {
  const venues = [
    { id: "v1", name: "Marina Bayview Hall A", address: "10 Bayfront Ave", max_capacity: 300 },
    { id: "v2", name: "Orchard Suite 1", address: "391A Orchard Road", max_capacity: 40 },
  ];

  it("SCRUM-129/AC10 an empty catalogue shows a message", () => {
    render(<VenueList venues={[]} />);
    expect(screen.getByText("No venues in the catalogue yet.")).toBeTruthy();
  });

  it("SCRUM-129/AC1 the filter narrows the list by name or location and says when nothing matches", () => {
    render(<VenueList venues={venues} />);
    expect(screen.getByRole("status").textContent).toBe("2 venues");

    fireEvent.change(screen.getByLabelText("Filter venues"), { target: { value: "orchard" } });
    expect(screen.queryByRole("link", { name: "Marina Bayview Hall A" })).toBeNull();
    expect(screen.getByRole("link", { name: "Orchard Suite 1" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("1 venue");

    fireEvent.change(screen.getByLabelText("Filter venues"), { target: { value: "zzz" } });
    expect(screen.getByText('No venues match "zzz".')).toBeTruthy();
  });

  it("SCRUM-129/AC10 the list and detail pages have a loading state", () => {
    render(<Loading />);
    expect(screen.getByLabelText("Loading the venue catalogue").getAttribute("aria-busy")).toBe("true");
    render(<DetailLoading />);
    expect(screen.getByLabelText("Loading the venue").getAttribute("aria-busy")).toBe("true");
  });
});
