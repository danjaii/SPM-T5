import { utcToSgt } from "@spm-t5/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VenueSearchForm } from "@/components/VenueSearchForm";
import { VenueSearchResults } from "@/components/VenueSearchResults";
import { searchVenues, type VenueSearchResultView } from "@/lib/venueSearch";

const options = {
  layouts: [{ id: "theatre", name: "Theatre" }],
  facilities: [{ id: "projector", name: "Projector" }, { id: "mic", name: "Microphone" }],
};

const venue = (changes: Partial<VenueSearchResultView> = {}): VenueSearchResultView => ({
  id: "v1",
  name: "Orchid Hall",
  address: "1 Orchard Road",
  max_capacity: 150,
  opening_time: "08:00",
  closing_time: "20:00",
  is_accessible: true,
  accessibility_notes: "Step-free entrance",
  layouts: [{ id: "theatre", name: "Theatre", max_capacity: 120 }],
  facilities: [{ id: "projector", name: "Projector" }],
  ...changes,
});

/** A pretend venue-service; the form never reaches the network. */
const fakeSearch = (reply: Awaited<ReturnType<typeof searchVenues>>) => vi.fn(async () => reply);

/** Fills the period. The end date follows the start date unless one is given, as it does for a person. */
function fill(changes: Partial<Record<"date" | "start" | "end" | "endDate", string>> = {}) {
  const v = { date: "2099-10-15", start: "09:00", end: "17:00", ...changes };
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: v.date } });
  fireEvent.change(screen.getByLabelText("Start time"), { target: { value: v.start } });
  if (v.endDate) fireEvent.change(screen.getByLabelText("End date"), { target: { value: v.endDate } });
  fireEvent.change(screen.getByLabelText("End time"), { target: { value: v.end } });
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Search venues" }));

afterEach(() => vi.restoreAllMocks());

describe("SCRUM-65/AC1 the form asks venue-service for the chosen period", () => {
  it("sends date and times, and shows the venues returned", async () => {
    const search = fakeSearch({ ok: true, data: { venues: [venue()] } });
    render(<VenueSearchForm options={options} search={search} />);
    fill();
    submit();

    expect(await screen.findByText("Orchid Hall")).toBeTruthy();
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: "2099-10-15", startTime: "09:00", endDate: "2099-10-15", endTime: "17:00" }),
    );
  });

  it("SCRUM-65/AC1 the end date follows the start date, so a one-day search needs one date", () => {
    render(<VenueSearchForm options={options} search={fakeSearch({ ok: true, data: { venues: [] } })} />);
    fill();
    expect((screen.getByLabelText("End date") as HTMLInputElement).value).toBe("2099-10-15");
  });

  it("SCRUM-65/AC1 sends a period over several days, and moves a now-earlier end date up to the start", async () => {
    const search = fakeSearch({ ok: true, data: { venues: [] } });
    render(<VenueSearchForm options={options} search={search} />);
    fill({ endDate: "2099-10-17" });
    expect((screen.getByLabelText("End date") as HTMLInputElement).min).toBe("2099-10-15");

    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2099-10-20" } }); // after the end date
    expect((screen.getByLabelText("End date") as HTMLInputElement).value).toBe("2099-10-20");

    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2099-10-22" } });
    submit();
    await waitFor(() => expect(search).toHaveBeenCalled());
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ startDate: "2099-10-20", endDate: "2099-10-22" }));
  });
});

describe("SCRUM-65/AC2 optional filters are sent", () => {
  it("sends attendance, location, layout, accessibility and chosen facilities", async () => {
    const search = fakeSearch({ ok: true, data: { venues: [] } });
    render(<VenueSearchForm options={options} search={search} />);
    fill();
    fireEvent.change(screen.getByLabelText("Expected attendance (optional)"), { target: { value: "80" } });
    fireEvent.change(screen.getByLabelText("Location (optional)"), { target: { value: "Orchard" } });
    fireEvent.change(screen.getByLabelText("Room layout (optional)"), { target: { value: "theatre" } });
    fireEvent.click(screen.getByLabelText("Accessible venues only"));
    fireEvent.click(screen.getByLabelText("Projector"));
    fireEvent.click(screen.getByLabelText("Microphone"));
    fireEvent.click(screen.getByLabelText("Microphone")); // switched off again
    submit();

    await waitFor(() => expect(search).toHaveBeenCalled());
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ attendance: "80", location: "Orchard", layoutId: "theatre", accessible: true, facilityIds: ["projector"] }),
    );
  });
});

describe("SCRUM-65/AC3 an invalid attendance is refused before searching", () => {
  it("shows a message and does not search", () => {
    const search = fakeSearch({ ok: true, data: { venues: [] } });
    render(<VenueSearchForm options={options} search={search} />);
    fill();
    fireEvent.change(screen.getByLabelText("Expected attendance (optional)"), { target: { value: "0" } });
    submit();

    expect(screen.getByText("Please enter a whole number of at least 1.")).toBeTruthy();
    expect(search).not.toHaveBeenCalled();
  });
});

describe("SCRUM-65/AC4 missing date or time", () => {
  it("prompts for the missing dates and does not search", () => {
    const search = fakeSearch({ ok: true, data: { venues: [] } });
    render(<VenueSearchForm options={options} search={search} />);
    submit();

    expect(screen.getByText("Please enter a start date.")).toBeTruthy();
    expect(screen.getByText("Please enter an end date.")).toBeTruthy();
    expect(search).not.toHaveBeenCalled();
  });

  it("prompts for a cleared start time", () => {
    render(<VenueSearchForm options={options} search={fakeSearch({ ok: true, data: { venues: [] } })} />);
    fill();
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "" } });
    submit();
    expect(screen.getByText("Please enter a start time.")).toBeTruthy();
  });
});

describe("SCRUM-65/AC5 past dates", () => {
  it("sets the start date box's min to today so past days cannot be picked", () => {
    render(<VenueSearchForm options={options} />);
    expect(screen.getByLabelText("Start date").getAttribute("min")).toBe(utcToSgt(new Date()).date);
  });

  it("refuses a typed past date without searching", () => {
    const search = fakeSearch({ ok: true, data: { venues: [] } });
    render(<VenueSearchForm options={options} search={search} />);
    fill({ date: "2000-01-01" });
    submit();

    expect(screen.getByText("The start date must not be in the past.")).toBeTruthy();
    expect(search).not.toHaveBeenCalled();
  });
});

describe("SCRUM-65/AC6 end before start", () => {
  it("refuses the search and says the end must be after the start", () => {
    const search = fakeSearch({ ok: true, data: { venues: [] } });
    render(<VenueSearchForm options={options} search={search} />);
    fill({ start: "17:00", end: "09:00" });
    submit();

    expect(screen.getByText("The end time must be after the start time.")).toBeTruthy();
    expect(search).not.toHaveBeenCalled();
  });

  it("refuses an end date before the start date typed in by hand", () => {
    const search = fakeSearch({ ok: true, data: { venues: [] } });
    render(<VenueSearchForm options={options} search={search} />);
    fill({ endDate: "2099-10-14" });
    submit();

    expect(screen.getByText("The end date must not be before the start date.")).toBeTruthy();
    expect(search).not.toHaveBeenCalled();
  });
});

describe("SCRUM-65 service errors", () => {
  it("shows the service's field errors on the boxes", async () => {
    const search = fakeSearch({ ok: false, data: { error: "Some fields are invalid.", fieldErrors: { location: "Too long." } } as never });
    render(<VenueSearchForm options={options} search={search} />);
    fill();
    submit();
    expect(await screen.findByText("Too long.")).toBeTruthy();
  });

  it("shows the service's message, or a fallback", async () => {
    const search = fakeSearch({ ok: false, data: {} as never });
    render(<VenueSearchForm options={options} search={search} />);
    fill();
    submit();
    expect((await screen.findByRole("alert")).textContent).toContain("couldn't search for venues");
  });
});

describe("SCRUM-65/AC7 each result displays its details", () => {
  it("shows name, location, capacity, accessibility, layouts and facilities", () => {
    render(<VenueSearchResults venues={[venue()]} />);

    expect(screen.getByRole("link", { name: "Orchid Hall" }).getAttribute("href")).toBe("/venues/v1");
    expect(screen.getByText("1 Orchard Road")).toBeTruthy();
    expect(screen.getByText("150")).toBeTruthy();
    expect(screen.getByText("08:00 – 20:00")).toBeTruthy();
    expect(screen.getByText("Accessible (Step-free entrance)")).toBeTruthy();
    expect(screen.getByText("Theatre (120)")).toBeTruthy();
    expect(screen.getByText("Projector")).toBeTruthy();
  });

  it("says when a venue is not accessible or lists nothing", () => {
    render(<VenueSearchResults venues={[venue({ opening_time: null, closing_time: null, is_accessible: false, accessibility_notes: null, layouts: [], facilities: [] })]} />);
    expect(screen.getByText("Not stated")).toBeTruthy();
    expect(screen.getByText("Not accessible")).toBeTruthy();
    expect(screen.getAllByText("None listed")).toHaveLength(2);
  });
});

describe("SCRUM-65/AC8 no match", () => {
  it("tells the user no suitable venues were found", async () => {
    render(<VenueSearchForm options={options} search={fakeSearch({ ok: true, data: { venues: [] } })} />);
    fill();
    submit();
    expect((await screen.findByRole("status")).textContent).toContain("No suitable venues were found");
  });
});
