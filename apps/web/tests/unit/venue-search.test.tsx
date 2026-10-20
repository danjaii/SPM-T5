import { utcToSgt } from "@spm-t5/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VenueCatalogue } from "@/components/VenueCatalogue";
import { emptyVenueQuery, filterChips, queryFromEvent, relaxHint, withoutFilter } from "@/lib/venueFilters";
import type { EventDetailView } from "@/lib/events";
import { searchVenues, type VenueSearchResultView } from "@/lib/venueSearch";

const options = {
  layouts: [{ id: "theatre", name: "Theatre" }, { id: "classroom", name: "Classroom" }],
  facilities: [{ id: "projector", name: "Projector" }, { id: "mic", name: "Microphone" }],
};

const catalogue = [
  { id: "v1", name: "Orchid Hall", address: "1 Orchard Road", max_capacity: 150 },
  { id: "v2", name: "Lotus Room", address: "2 Bayfront Ave", max_capacity: 40 },
];

const venue = (changes: Partial<VenueSearchResultView> = {}): VenueSearchResultView => ({
  ...catalogue[0],
  opening_time: "08:00",
  closing_time: "20:00",
  is_accessible: true,
  accessibility_notes: "Step-free entrance",
  layouts: [{ id: "theatre", name: "Theatre", max_capacity: 120 }],
  facilities: [{ id: "projector", name: "Projector" }],
  ...changes,
});

/** A pretend venue-service; the page never reaches the network. */
const fakeSearch = (reply: Awaited<ReturnType<typeof searchVenues>>) => vi.fn(async () => reply);
const found = (venues: VenueSearchResultView[]) => fakeSearch({ ok: true, data: { venues } });

function fill(changes: Partial<Record<"date" | "start" | "end" | "endDate", string>> = {}) {
  const v = { date: "2099-10-15", start: "09:00", end: "17:00", ...changes };
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: v.date } });
  fireEvent.change(screen.getByLabelText("Start time"), { target: { value: v.start } });
  if (v.endDate) fireEvent.change(screen.getByLabelText("End date"), { target: { value: v.endDate } });
  fireEvent.change(screen.getByLabelText("End time"), { target: { value: v.end } });
}
const apply = () => fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

afterEach(() => vi.restoreAllMocks());

const event = {
  id: "e1",
  name: "Annual Tech Summit",
  preferred_start_datetime: "2099-11-14T01:00:00Z", // 09:00 in Singapore
  preferred_end_datetime: "2099-11-14T09:00:00Z", // 17:00
  expected_attendance: 60,
  preferred_layout_name: "classroom",
  accessibility_requirements: "Wheelchair access",
} as EventDetailView;

describe("SCRUM-131/AC1 filters pre-filled from an event", () => {
  it("turns the event's date, time, attendance, layout and accessibility into filters", () => {
    expect(queryFromEvent(event, options)).toEqual({
      ...emptyVenueQuery,
      startDate: "2099-11-14",
      startTime: "09:00",
      endDate: "2099-11-14",
      endTime: "17:00",
      attendance: "60",
      layoutId: "classroom",
      accessible: true,
    });
  });

  it("fills the form, says where it came from and searches on load", async () => {
    const search = found([venue()]);
    render(
      <VenueCatalogue venues={catalogue} options={options} search={search}
        prefill={{ eventName: "Annual Tech Summit", query: queryFromEvent(event, options), requirements: "Projector" }} />,
    );

    expect(screen.getByText("Filters are pre-filled from Annual Tech Summit")).toBeTruthy();
    expect(screen.getByText("Venue requirements: Projector")).toBeTruthy();
    expect((screen.getByLabelText("Start date") as HTMLInputElement).value).toBe("2099-11-14");
    expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("09:00");
    expect((screen.getByLabelText("People (optional)") as HTMLInputElement).value).toBe("60");
    expect(screen.getByRole("button", { name: "Classroom" }).getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Open 08:00–20:00")).toBeTruthy();
  });
});

describe("SCRUM-131/AC2 active filters are removable chips", () => {
  it("shows a chip for each active filter above the results", async () => {
    render(<VenueCatalogue venues={catalogue} options={options} search={found([venue()])} />);
    fill();
    fireEvent.change(screen.getByLabelText("People (optional)"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Theatre" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Projector" }));
    apply();

    const chips = await screen.findByRole("list", { name: "Active filters" });
    const labels = within(chips).getAllByRole("listitem").map((li) => li.textContent);
    expect(labels).toEqual(["2099-10-15, 09:00–17:00", "60 people", "Layout: Theatre", "Projector"]);
  });

  it("removing a chip clears that filter and searches again", async () => {
    const search = found([venue()]);
    render(<VenueCatalogue venues={catalogue} options={options} search={search} />);
    fill();
    fireEvent.change(screen.getByLabelText("People (optional)"), { target: { value: "60" } });
    apply();
    fireEvent.click(await screen.findByRole("button", { name: "Remove filter 60 people" }));

    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ attendance: "" }));
    expect((screen.getByLabelText("People (optional)") as HTMLInputElement).value).toBe("");
  });

  it("removing the date chip leaves nothing to search, so the whole catalogue comes back", async () => {
    render(<VenueCatalogue venues={catalogue} options={options} search={found([venue()])} />);
    fill();
    apply();
    fireEvent.click(await screen.findByRole("button", { name: /Remove filter 2099-10-15/ }));

    expect(await screen.findByRole("link", { name: "Lotus Room" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Active filters" })).toBeNull();
  });

  it("builds a chip per filter and removes the right one", () => {
    const q = { ...emptyVenueQuery, startDate: "2099-10-15", endDate: "2099-10-16", attendance: "5", location: "Orchard", accessible: true, facilityIds: ["mic"] };
    expect(filterChips(q, options).map((c) => c.key)).toEqual(["period", "attendance", "location", "accessible", "facility:mic"]);
    expect(withoutFilter(q, "facility:mic").facilityIds).toEqual([]);
    expect(withoutFilter(q, "location").location).toBe("");
    expect(withoutFilter(q, "accessible").accessible).toBe(false);
    expect(withoutFilter(q, "unknown")).toBe(q);
  });
});

describe("SCRUM-131/AC3 no venue matches", () => {
  it("suggests which filters to relax", async () => {
    render(<VenueCatalogue venues={catalogue} options={options} search={found([])} />);
    fill();
    fireEvent.change(screen.getByLabelText("People (optional)"), { target: { value: "900" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Projector" }));
    apply();

    expect(await screen.findByText("No venue matches every filter. Try relaxing: required facilities, attendance.")).toBeTruthy();
  });

  it("falls back to the date and time when no optional filter is in use", () => {
    expect(relaxHint({ ...emptyVenueQuery, startDate: "2099-10-15" })).toBe("No venue is free for this date and time. Try a different date or time.");
  });
});

describe("SCRUM-131 the search is part of the catalogue", () => {
  it("shows the plain catalogue until a search is applied, and Reset returns to it", async () => {
    render(<VenueCatalogue venues={catalogue} options={options} search={found([venue()])} />);
    expect(screen.getByRole("link", { name: "Lotus Room" })).toBeTruthy();
    fill();
    apply();
    await screen.findByText("1 venue free");
    expect(screen.queryByRole("link", { name: "Lotus Room" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("link", { name: "Lotus Room" })).toBeTruthy();
  });

  it("shows no filters for a role that may not search", () => {
    render(<VenueCatalogue venues={catalogue} />);
    expect(screen.queryByRole("form", { name: "Venue filters" })).toBeNull();
    expect(screen.getByRole("link", { name: "Orchid Hall" })).toBeTruthy();
  });
});

describe("SCRUM-65 the filters ask venue-service for the chosen period and check input first", () => {
  it("AC1 sends date and times; the end date follows the start date and has it as its minimum", async () => {
    const search = found([venue()]);
    render(<VenueCatalogue venues={catalogue} options={options} search={search} />);
    fill();
    expect((screen.getByLabelText("End date") as HTMLInputElement).value).toBe("2099-10-15");
    expect((screen.getByLabelText("End date") as HTMLInputElement).min).toBe("2099-10-15");
    apply();
    await waitFor(() =>
      expect(search).toHaveBeenCalledWith(
        expect.objectContaining({ startDate: "2099-10-15", startTime: "09:00", endDate: "2099-10-15", endTime: "17:00" }),
      ),
    );
  });

  it("AC2 sends the optional filters", async () => {
    const search = found([]);
    render(<VenueCatalogue venues={catalogue} options={options} search={search} />);
    fill();
    fireEvent.change(screen.getByLabelText("People (optional)"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Location (optional)"), { target: { value: "Orchard" } });
    fireEvent.click(screen.getByRole("button", { name: "Theatre" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Accessible venue" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Projector" }));
    apply();
    await waitFor(() =>
      expect(search).toHaveBeenCalledWith(
        expect.objectContaining({ attendance: "50", location: "Orchard", layoutId: "theatre", accessible: true, facilityIds: ["projector"] }),
      ),
    );
  });

  it("AC3-AC6 refuses a missing, past or backwards period without searching", () => {
    const search = found([]);
    render(<VenueCatalogue venues={catalogue} options={options} search={search} />);
    apply();
    fill({ date: "2000-01-01" });
    apply();
    fill({ date: "2099-10-15", start: "17:00", end: "09:00" });
    apply();
    expect(search).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Start date") as HTMLInputElement).min).toBe(utcToSgt(new Date()).date);
  });

  it("shows the service's message when the search fails", async () => {
    render(<VenueCatalogue venues={catalogue} options={options} search={fakeSearch({ ok: false, data: { error: "Venue service is down." } as Awaited<ReturnType<typeof searchVenues>>["data"] })} />);
    fill();
    apply();
    expect((await screen.findByRole("alert")).textContent).toContain("Venue service is down.");
  });

  it("AC7 shows each result's accessibility, layouts and facilities", async () => {
    render(<VenueCatalogue venues={catalogue} options={options} search={found([venue()])} />);
    fill();
    apply();
    expect(await screen.findByText("Accessible (Step-free entrance)")).toBeTruthy();
    expect(screen.getByText("Layouts: Theatre (120)")).toBeTruthy();
    expect(screen.getByText("Facilities: Projector")).toBeTruthy();
  });
});
