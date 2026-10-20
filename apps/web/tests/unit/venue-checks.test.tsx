import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VenueCatalogue } from "@/components/VenueCatalogue";
import { emptyVenueQuery } from "@/lib/venueFilters";
import { venueChecks } from "@/lib/venueChecks";
import { searchVenues, type VenueSearchResultView } from "@/lib/venueSearch";

const options = {
  layouts: [{ id: "theatre", name: "Theatre" }],
  facilities: [{ id: "projector", name: "Projector" }],
};
const catalogue = [{ id: "v1", name: "Orchid Hall", address: "1 Orchard Road", max_capacity: 120 }];
const venue = (changes: Partial<VenueSearchResultView> = {}): VenueSearchResultView => ({
  ...catalogue[0],
  opening_time: "08:00",
  closing_time: "20:00",
  is_accessible: true,
  accessibility_notes: null,
  layouts: [{ id: "theatre", name: "Theatre", max_capacity: 120 }],
  facilities: [{ id: "projector", name: "Projector" }],
  ...changes,
});
const query = { ...emptyVenueQuery, startDate: "2099-10-15", endDate: "2099-10-15", attendance: "150" };

describe("SCRUM-132/AC1 capacity shortfall", () => {
  it("shows Capacity 120 / need 150 as a miss, and the venue as not suitable", () => {
    const r = venueChecks(venue(), query, options);
    expect(r.overall).toBe("not_suitable");
    expect(r.checks.find((c) => c.key === "capacity")).toEqual({ key: "capacity", met: false, label: "Capacity 120 / need 150" });
  });
});

describe("SCRUM-132/AC2 every requirement met", () => {
  const all = { ...query, attendance: "100", layoutId: "theatre", accessible: true, facilityIds: ["projector"] };

  it("marks each requirement met and the venue suitable", () => {
    const r = venueChecks(venue(), all, options);
    expect(r.overall).toBe("suitable");
    expect(r.checks.every((c) => c.met)).toBe(true);
  });

  it("judges layout, hours, accessibility and facilities too", () => {
    const r = venueChecks(venue({ is_accessible: false, facilities: [], layouts: [], opening_time: "10:00" }), all, options);
    expect(r.checks.filter((c) => !c.met).map((c) => c.key)).toEqual(["layout", "hours", "accessible", "facility:projector"]);
  });

  it("lists nothing when the search sets no requirement", () => {
    expect(venueChecks(venue(), { ...emptyVenueQuery }, options).checks).toEqual([]);
  });
});

describe("SCRUM-132/AC1,AC2,AC3,AC6 on the result cards", () => {
  afterEach(() => vi.restoreAllMocks());

  const run = (venues: VenueSearchResultView[]) => vi.fn(async () => ({ ok: true as const, data: { venues } })) as unknown as typeof searchVenues;
  const open = async (search: typeof searchVenues) => {
    render(<VenueCatalogue venues={catalogue} options={options} prefill={{ eventName: "Summit", query }} search={search} />);
    await screen.findByLabelText("Requirement checks");
  };

  it("AC1: a card whose venue holds 120 for 150 shows the miss with its words and Not suitable", async () => {
    await open(run([venue()]));
    const row = screen.getByText("Capacity 120 / need 150").closest("li")!;
    expect(row.getAttribute("data-met")).toBe("false");
    expect(within(row).getByText("Not met:")).toBeTruthy();
    expect(screen.getByText("Not suitable")).toBeTruthy();
  });

  it("AC2: a card that meets everything shows Suitable", async () => {
    await open(run([venue({ max_capacity: 200, layouts: [] })]));
    expect(screen.getByText("Suitable")).toBeTruthy();
    expect(screen.getByText("Capacity 200 / need 150").closest("li")!.getAttribute("data-met")).toBe("true");
  });

  it("AC3: an unsuitable venue still links to its details", async () => {
    await open(run([venue()]));
    expect(screen.getByRole("link", { name: "Orchid Hall" }).getAttribute("href")).toBe("/venues/v1");
  });

  it("asks for unsuitable venues again when Show unsuitable venues is switched on", async () => {
    const search = run([venue()]);
    await open(search);
    fireEvent.click(screen.getByRole("checkbox", { name: "Show unsuitable venues" }));
    await waitFor(() => expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ includeUnsuitable: true })));
  });
});
