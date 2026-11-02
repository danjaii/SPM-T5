import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }), redirect: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Pretend loading helpers, so the page tests are only about the page itself
const { getVenues, getVenueSearchOptions, getEvent, canAddVenue } = vi.hoisted(() => ({
  getVenues: vi.fn(),
  getVenueSearchOptions: vi.fn(),
  getEvent: vi.fn(),
  canAddVenue: vi.fn(),
}));
vi.mock("@/lib/getVenues", () => ({ getVenues }));
vi.mock("@/lib/venueSearchServer", () => ({ getVenueSearchOptions }));
vi.mock("@/lib/getEvent", () => ({ getEvent }));
vi.mock("@/lib/venueCatalogueServer", () => ({ canAddVenue }));
vi.mock("@/lib/venueSearch", () => ({ searchVenues: vi.fn(async () => ({ ok: true, data: { venues: [] } })) }));

import NewVenuePage from "@/app/venues/new/page";
import VenuesPage from "@/app/venues/page";
import { VenueForm } from "@/components/VenueForm";
import { postVenue } from "@/lib/venueCatalogue";

const THEATRE = "a685c8bf-c57d-5cb4-be30-49dedce9a02b";
const CLASSROOM = "e2feef5a-7c9f-5085-a039-39a50f8d03b7";
const PROJECTOR = "8a02aa6c-e1ae-59e3-9d09-e5704315347d";
const options = {
  layouts: [
    { id: THEATRE, name: "Theatre" },
    { id: CLASSROOM, name: "Classroom" },
  ],
  facilities: [{ id: PROJECTOR, name: "Projector & Screen" }],
};

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const tick = (name: string) => fireEvent.click(screen.getByRole("checkbox", { name }));

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

describe("SCRUM-57/AC1 Venue Staff add a venue (57-S1)", () => {
  it("57-S1: sends what was filled in and then opens the new venue", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, data: { id: "venue-9" } });
    render(<VenueForm options={options} submit={submit} />);

    type(/^Name/, "  Orchid Hall ");
    type(/^Location/, "Level 3, 1 Raffles Place");
    type(/^Capacity/, "150");
    type("Opening time", "08:00");
    type("Closing time", "22:00");
    tick("Accessible venue");
    type("Accessibility notes", "Step-free entrance.");
    tick("Theatre");
    tick("Projector & Screen");
    fireEvent.click(screen.getByRole("button", { name: "Add venue" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/venues/venue-9"));
    expect(submit).toHaveBeenCalledWith({
      name: "Orchid Hall",
      address: "Level 3, 1 Raffles Place",
      description: null,
      maxCapacity: 150,
      operatingHoursStart: "08:00",
      operatingHoursEnd: "22:00",
      isAccessible: true,
      accessibilityNotes: "Step-free entrance.",
      // ticking a layout offers the venue's capacity as its own, which can be lowered
      layouts: [{ layoutId: THEATRE, maxCapacity: 150 }],
      facilityIds: [PROJECTOR],
    });
  });

  it("57-S1: a layout can seat fewer people than the venue holds", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, data: { id: "venue-9" } });
    render(<VenueForm options={options} submit={submit} />);

    type(/^Name/, "Lotus Room");
    type(/^Location/, "Level 1");
    type(/^Capacity/, "100");
    tick("Classroom");
    type("Capacity for Classroom", "60");
    fireEvent.click(screen.getByRole("button", { name: "Add venue" }));

    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0][0]).toMatchObject({ layouts: [{ layoutId: CLASSROOM, maxCapacity: 60 }], facilityIds: [] });
  });
});

describe("SCRUM-57/AC2 required fields (57-S2)", () => {
  it("57-S2: an empty form shows which fields are missing, sends nothing and keeps what was typed", () => {
    const submit = vi.fn();
    render(<VenueForm options={options} submit={submit} />);

    type(/^Location/, "Level 1");
    fireEvent.click(screen.getByRole("button", { name: "Add venue" }));

    expect(screen.getByText("Enter the venue's name.")).toBeTruthy();
    expect(screen.getByText(/Capacity must be a whole number/)).toBeTruthy();
    expect(screen.getByText("Choose at least one supported layout.")).toBeTruthy();
    expect(screen.queryByText("Enter the venue's location.")).toBeNull();
    expect((screen.getByLabelText(/^Location/) as HTMLInputElement).value).toBe("Level 1");
    expect(submit).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("57-S2: a message goes away as soon as its field is fixed, and the others stay until theirs are", () => {
    render(<VenueForm options={options} submit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add venue" }));
    expect(screen.getByText("Enter the venue's name.")).toBeTruthy();
    expect(screen.getByText("Enter the venue's location.")).toBeTruthy();
    expect(screen.getByText("Choose at least one supported layout.")).toBeTruthy();

    type(/^Name/, "Orchid Hall");
    expect(screen.queryByText("Enter the venue's name.")).toBeNull();
    expect(screen.getByText("Enter the venue's location.")).toBeTruthy();

    tick("Theatre");
    expect(screen.queryByText("Choose at least one supported layout.")).toBeNull();

    type(/^Location/, "Level 1");
    type("Capacity (required)", "40");
    // every message is gone, so the summary above the form goes too
    expect(screen.queryByText(/Some details need fixing/)).toBeNull();
  });

  it("57-S2: a layout seating more than the venue is explained", () => {
    render(<VenueForm options={options} submit={vi.fn()} />);

    type(/^Name/, "Lotus Room");
    type(/^Location/, "Level 1");
    type(/^Capacity/, "40");
    tick("Theatre");
    type("Capacity for Theatre", "60");
    fireEvent.click(screen.getByRole("button", { name: "Add venue" }));

    expect(screen.getByText(/cannot seat more than the venue's capacity of 40/)).toBeTruthy();
  });

  it("57-S2: what the server refuses is shown on the same fields, and the form stays open", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: false, data: { fieldErrors: { layouts: "One of the layouts is not in the catalogue. Choose it from the list." } } });
    render(<VenueForm options={options} submit={submit} />);

    type(/^Name/, "Lotus Room");
    type(/^Location/, "Level 1");
    type(/^Capacity/, "40");
    tick("Theatre");
    fireEvent.click(screen.getByRole("button", { name: "Add venue" }));

    expect(await screen.findByText(/One of the layouts is not in the catalogue/)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("57-S2: a failure with no field to blame is shown as a message, and the form can be sent again", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: false, data: { error: "We couldn't reach the server. Please try again." } });
    render(<VenueForm options={options} submit={submit} />);

    type(/^Name/, "Lotus Room");
    type(/^Location/, "Level 1");
    type(/^Capacity/, "40");
    tick("Theatre");
    fireEvent.click(screen.getByRole("button", { name: "Add venue" }));

    expect((await screen.findByRole("alert")).textContent).toContain("We couldn't reach the server");
    expect((screen.getByRole("button", { name: "Add venue" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("SCRUM-57/AC1,AC2 the browser call", () => {
  it("57-S1: posts the venue as JSON with the login cookie and hands back the answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "venue-9" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await postVenue({ name: "Orchid Hall" } as never);

    expect(result).toEqual({ ok: true, data: { id: "venue-9" } });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/venues$/),
      expect.objectContaining({ method: "POST", credentials: "include", body: JSON.stringify({ name: "Orchid Hall" }) }),
    );
  });

  it("57-S2: a server that cannot be reached is an error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await postVenue({} as never);
    expect(result.ok).toBe(false);
    expect(result.data.error).toMatch(/couldn't reach the server/i);
  });
});

describe("SCRUM-57/AC3 only Venue Staff are offered the action (57-S3)", () => {
  const venues = { venues: [{ id: "v1", name: "Orchid Hall", address: "Level 3", max_capacity: 150 }] };

  it("57-S3: the catalogue offers 'Add venue' to venue staff", async () => {
    getVenues.mockResolvedValue(venues);
    getVenueSearchOptions.mockResolvedValue({ error: "no" });
    canAddVenue.mockResolvedValue(true);

    render(await VenuesPage({}));

    expect(screen.getByRole("link", { name: "Add venue" }).getAttribute("href")).toBe("/venues/new");
  });

  it("57-S3: a coordinator is not offered it", async () => {
    getVenues.mockResolvedValue(venues);
    getVenueSearchOptions.mockResolvedValue({ error: "no" });
    canAddVenue.mockResolvedValue(false);

    render(await VenuesPage({}));

    expect(screen.queryByRole("link", { name: "Add venue" })).toBeNull();
  });

  it("57-S3: /venues/new shows the form to venue staff", async () => {
    canAddVenue.mockResolvedValue(true);
    getVenueSearchOptions.mockResolvedValue({ options });

    render(await NewVenuePage());

    expect(screen.getByRole("heading", { name: "Add a venue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add venue" })).toBeTruthy();
  });

  it("57-S3: /venues/new tells anyone else why they cannot add one, and shows no form", async () => {
    canAddVenue.mockResolvedValue(false);

    render(await NewVenuePage());

    expect(screen.getByRole("alert").textContent).toBe("Only venue staff can add a venue.");
    expect(screen.queryByRole("button", { name: "Add venue" })).toBeNull();
  });

  it("57-S3: if the layouts and facilities cannot be loaded the reason is shown instead of a form", async () => {
    canAddVenue.mockResolvedValue(true);
    getVenueSearchOptions.mockResolvedValue({ error: "We couldn't reach the venue service. Please try again." });

    render(await NewVenuePage());

    expect(screen.getByRole("alert").textContent).toBe("We couldn't reach the venue service. Please try again.");
    expect(screen.queryByRole("button", { name: "Add venue" })).toBeNull();
  });
});
