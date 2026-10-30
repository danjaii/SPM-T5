import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VenueInput } from "@spm-t5/shared";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }), redirect: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Pretend loading helpers, so the page tests are only about the page itself
const { canEditVenue, getVenueForEdit, getVenueSearchOptions } = vi.hoisted(() => ({
  canEditVenue: vi.fn(),
  getVenueForEdit: vi.fn(),
  getVenueSearchOptions: vi.fn(),
}));
vi.mock("@/lib/venueCatalogueServer", () => ({ canEditVenue, getVenueForEdit, canAddVenue: vi.fn() }));
vi.mock("@/lib/venueSearchServer", () => ({ getVenueSearchOptions }));

import EditVenuePage from "@/app/venues/[id]/edit/page";
import { VenueDetail, type VenueDetails } from "@/components/VenueDetail";
import { VenueForm } from "@/components/VenueForm";
import { putVenue } from "@/lib/venueCatalogue";

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

const orchid = (): VenueInput => ({
  name: "Orchid Hall",
  address: "Level 3, 1 Raffles Place",
  description: "A hall for talks.",
  maxCapacity: 150,
  operatingHoursStart: "08:00",
  operatingHoursEnd: "22:00",
  isAccessible: true,
  accessibilityNotes: "Step-free entrance.",
  layouts: [{ layoutId: THEATRE, maxCapacity: 150 }],
  facilityIds: [PROJECTOR],
});

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const tick = (name: string) => fireEvent.click(screen.getByRole("checkbox", { name }));
const field = (label: string | RegExp) => (screen.getByLabelText(label) as HTMLInputElement).value;
const isTicked = (name: string) => screen.getByRole("checkbox", { name }).getAttribute("aria-checked") === "true";

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

describe("SCRUM-58/AC1 venue staff edit a venue (58-S1)", () => {
  it("58-S1: the form is filled in with the venue's current values", () => {
    render(<VenueForm options={options} venueId="orchid" initial={orchid()} submit={vi.fn()} />);

    expect(field(/^Name/)).toBe("Orchid Hall");
    expect(field(/^Location/)).toBe("Level 3, 1 Raffles Place");
    expect(field("Description")).toBe("A hall for talks.");
    expect(field("Capacity (required)")).toBe("150");
    expect(field("Opening time")).toBe("08:00");
    expect(field("Closing time")).toBe("22:00");
    expect(isTicked("Accessible venue")).toBe(true);
    expect(field("Accessibility notes")).toBe("Step-free entrance.");
    expect(isTicked("Theatre")).toBe(true);
    expect(field("Capacity for Theatre")).toBe("150");
    expect(isTicked("Classroom")).toBe(false);
    expect(isTicked("Projector & Screen")).toBe(true);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add venue" })).toBeNull();
  });

  it("58-S1: sends what was changed, and opens the venue's page", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, data: { id: "orchid" } });
    render(<VenueForm options={options} venueId="orchid" initial={orchid()} submit={submit} />);

    type(/^Name/, "  Orchid Hall East ");
    type("Capacity (required)", "200");
    tick("Classroom");
    type("Capacity for Classroom", "120");
    tick("Projector & Screen");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/venues/orchid"));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({
      ...orchid(),
      name: "Orchid Hall East",
      maxCapacity: 200,
      layouts: [
        { layoutId: THEATRE, maxCapacity: 150 },
        { layoutId: CLASSROOM, maxCapacity: 120 },
      ],
      facilityIds: [],
    });
  });
});

describe("SCRUM-58/AC2 required fields cannot be cleared (58-S2)", () => {
  it("58-S2: clearing a required field says which, sends nothing and keeps the rest", () => {
    const submit = vi.fn();
    render(<VenueForm options={options} venueId="orchid" initial={orchid()} submit={submit} />);

    type(/^Name/, "");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByText("Enter the venue's name.")).toBeTruthy();
    expect(field(/^Location/)).toBe("Level 3, 1 Raffles Place");
    expect(submit).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("58-S2: unticking the only layout is refused", () => {
    const submit = vi.fn();
    render(<VenueForm options={options} venueId="orchid" initial={orchid()} submit={submit} />);

    tick("Theatre");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByText("Choose at least one supported layout.")).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
  });

  it("58-S2: what the server refuses is shown on its field, and the form stays open", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: false, data: { fieldErrors: { layouts: "One of the layouts is not in the catalogue. Choose it from the list." } } });
    render(<VenueForm options={options} venueId="orchid" initial={orchid()} submit={submit} />);

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(/One of the layouts is not in the catalogue/)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("SCRUM-58/AC4 a capacity cut that leaves a booking over capacity asks first (58-S4)", () => {
  const affected = [
    { bookingId: "b1", eventName: "Annual Tech Summit", eventStart: "2099-03-10T01:00:00Z", eventEnd: "2099-03-10T09:00:00Z", expectedAttendance: 120, status: "approved" },
    { bookingId: "b2", eventName: "Board Offsite", eventStart: "2099-03-12T01:00:00Z", eventEnd: "2099-03-12T09:00:00Z", expectedAttendance: 110, status: "requested" },
  ];
  const asks = { ok: false, data: { code: "CONFIRM_IMPACT", error: "These bookings expect more people than the venue would hold. Check them before saving.", affected } };

  function cutTo100(submit: ReturnType<typeof vi.fn>) {
    render(<VenueForm options={options} venueId="orchid" initial={orchid()} submit={submit} />);
    type("Capacity (required)", "100");
    type("Capacity for Theatre", "100");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  }

  it("58-S4: lists the bookings with their attendance and status, and saves nothing yet", async () => {
    const submit = vi.fn().mockResolvedValue(asks);
    cutTo100(submit);

    const panel = await screen.findByRole("alert");
    expect(within(panel).getByText(/expect more people than the venue would hold/i)).toBeTruthy();
    expect(within(panel).getByText("Annual Tech Summit")).toBeTruthy();
    expect(within(panel).getByText(/120 people/)).toBeTruthy();
    expect(within(panel).getByText(/Approved/)).toBeTruthy();
    expect(within(panel).getByText("Board Offsite")).toBeTruthy();
    expect(within(panel).getByText(/Pending/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save anyway" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep editing" })).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    expect(submit.mock.calls[0][0]).not.toHaveProperty("confirmImpact");
  });

  it("58-S4: Save anyway sends the same venue again with confirmImpact, then opens the venue's page", async () => {
    const submit = vi.fn().mockResolvedValueOnce(asks).mockResolvedValueOnce({ ok: true, data: { id: "orchid" } });
    cutTo100(submit);

    fireEvent.click(await screen.findByRole("button", { name: "Save anyway" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/venues/orchid"));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0]).toMatchObject({ maxCapacity: 100, confirmImpact: true });
  });

  it("58-S4: Keep editing closes the list and saves nothing", async () => {
    const submit = vi.fn().mockResolvedValue(asks);
    cutTo100(submit);

    fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));

    expect(screen.queryByRole("button", { name: "Save anyway" })).toBeNull();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("58-S4: changing anything after the list was shown withdraws it, so a confirmation never covers a different edit", async () => {
    const submit = vi.fn().mockResolvedValue(asks);
    cutTo100(submit);
    await screen.findByRole("button", { name: "Save anyway" });

    type("Capacity (required)", "90");

    expect(screen.queryByRole("button", { name: "Save anyway" })).toBeNull();
  });
});

describe("SCRUM-58/AC1,AC2,AC4 the browser call", () => {
  it("58-S1: PUTs the venue as JSON with the login cookie and hands back the answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "orchid" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await putVenue("orchid", { ...orchid(), confirmImpact: true });

    expect(result).toEqual({ ok: true, data: { id: "orchid" } });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/venues\/orchid$/),
      expect.objectContaining({ method: "PUT", credentials: "include", body: JSON.stringify({ ...orchid(), confirmImpact: true }) }),
    );
  });

  it("58-S2: a server that cannot be reached is an error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await putVenue("orchid", orchid());
    expect(result.ok).toBe(false);
    expect(result.data.error).toMatch(/couldn't reach the server/i);
  });
});

describe("SCRUM-58/AC3 only Venue Staff are offered the edit (58-S3)", () => {
  const detail = (extra: Partial<VenueDetails> = {}): VenueDetails => ({
    id: "orchid", name: "Orchid Hall", address: "Level 3", description: null, max_capacity: 150,
    operating_hours_start: null, operating_hours_end: null, is_accessible: true, accessibility_notes: null,
    layouts: [], facilities: [], setup_minutes: 0, turnaround_minutes: 0, can_edit_timing: false,
    ...extra,
  });

  it("58-S3: venue staff get an Edit venue link to the edit page, and Edit times for the setup and turnaround", () => {
    render(<VenueDetail venue={detail({ can_edit_timing: true, can_manage_catalogue: true })} />);

    expect(screen.getByRole("link", { name: "Edit venue" }).getAttribute("href")).toBe("/venues/orchid/edit");
    expect(screen.getByRole("button", { name: "Edit times" })).toBeTruthy();
  });

  it("58-S3: everyone else gets neither", () => {
    render(<VenueDetail venue={detail()} />);

    expect(screen.queryByRole("link", { name: "Edit venue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit times" })).toBeNull();
  });

  it("58-S3: /venues/[id]/edit shows the filled-in form to venue staff", async () => {
    canEditVenue.mockResolvedValue(true);
    getVenueSearchOptions.mockResolvedValue({ options });
    getVenueForEdit.mockResolvedValue({ venue: orchid() });

    render(await EditVenuePage({ params: Promise.resolve({ id: "orchid" }) }));

    expect(getVenueForEdit).toHaveBeenCalledWith("orchid");
    expect(screen.getByRole("heading", { name: "Edit Orchid Hall" })).toBeTruthy();
    expect(field(/^Name/)).toBe("Orchid Hall");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  });

  it("58-S3: /venues/[id]/edit tells anyone else why they cannot edit, and shows no form", async () => {
    canEditVenue.mockResolvedValue(false);
    getVenueForEdit.mockClear();

    render(await EditVenuePage({ params: Promise.resolve({ id: "orchid" }) }));

    expect(screen.getByRole("alert").textContent).toBe("Only venue staff can edit a venue.");
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(getVenueForEdit).not.toHaveBeenCalled();
  });

  it("58-S3: an unknown venue, or a service that cannot be reached, is shown as the reason instead of a form", async () => {
    canEditVenue.mockResolvedValue(true);
    getVenueSearchOptions.mockResolvedValue({ options });
    getVenueForEdit.mockResolvedValue({ error: "Venue not found." });

    render(await EditVenuePage({ params: Promise.resolve({ id: "nope" }) }));

    expect(screen.getByRole("alert").textContent).toBe("Venue not found.");
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });
});
