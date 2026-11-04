import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LayoutTypeView } from "@spm-t5/shared";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), redirect: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Pretend loading helpers, so the page tests are only about the page itself
const { getLayoutTypes, canManageLayoutTypes, getVenues, getVenueSearchOptions, getEvent, canAddVenue } = vi.hoisted(() => ({
  getLayoutTypes: vi.fn(),
  canManageLayoutTypes: vi.fn(),
  getVenues: vi.fn(),
  getVenueSearchOptions: vi.fn(),
  getEvent: vi.fn(),
  canAddVenue: vi.fn(),
}));
vi.mock("@/lib/layoutTypesServer", () => ({ getLayoutTypes, canManageLayoutTypes }));
vi.mock("@/lib/getVenues", () => ({ getVenues }));
vi.mock("@/lib/venueSearchServer", () => ({ getVenueSearchOptions }));
vi.mock("@/lib/getEvent", () => ({ getEvent }));
vi.mock("@/lib/venueCatalogueServer", () => ({ canAddVenue }));
vi.mock("@/lib/venueSearch", () => ({ searchVenues: vi.fn(async () => ({ ok: true, data: { venues: [] } })) }));

import LayoutTypesPage from "@/app/venues/layout-types/page";
import VenuesPage from "@/app/venues/page";
import { LayoutTypeManager } from "@/components/LayoutTypeManager";
import { VenueForm } from "@/components/VenueForm";
import { deleteLayoutType, patchLayoutType, postLayoutType } from "@/lib/layoutTypes";

const THEATRE: LayoutTypeView = { id: "l-theatre", name: "Theatre", isActive: true, venueCount: 2 };
const BANQUET: LayoutTypeView = { id: "l-banquet", name: "Banquet", isActive: true, venueCount: 0 };

const api = (over: Partial<NonNullable<Parameters<typeof LayoutTypeManager>[0]["api"]>> = {}) => ({
  add: vi.fn().mockResolvedValue({ ok: true, data: { id: "l-new", name: "Cabaret" } }),
  rename: vi.fn().mockResolvedValue({ ok: true, data: { id: "l-theatre", name: "Lecture Theatre" } }),
  remove: vi.fn().mockResolvedValue({ ok: true, data: { id: "l-banquet", name: "Banquet" } }),
  ...over,
});

const names = () => within(screen.getByRole("list", { name: "Layout types" })).getAllByRole("listitem").map((li) => li.querySelector("p")?.textContent ?? "");

afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-181/AC1 Venue Staff add a layout type (181-S1)", () => {
  it("181-S1: sends the name, adds the type to the list in name order, and clears the box", async () => {
    const send = api();
    render(<LayoutTypeManager initial={[THEATRE, BANQUET]} api={send} />);

    fireEvent.change(screen.getByLabelText("New layout type"), { target: { value: "  Cabaret " } });
    fireEvent.click(screen.getByRole("button", { name: "Add layout type" }));

    await waitFor(() => expect(names()).toEqual(["Banquet", "Cabaret", "Theatre"]));
    expect(send.add).toHaveBeenCalledWith("  Cabaret ");
    expect((screen.getByLabelText("New layout type") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("status").textContent).toContain('Added "Cabaret"');
  });

  it("181-S1: the list says how many venues use each type", () => {
    render(<LayoutTypeManager initial={[THEATRE, BANQUET]} api={api()} />);

    expect(screen.getByText("2 venues use it")).toBeTruthy();
    expect(screen.getByText("No venues use it")).toBeTruthy();
  });

  it("181-S1: an empty list says so", () => {
    render(<LayoutTypeManager initial={[]} api={api()} />);

    expect(screen.getByText("There are no layout types yet.")).toBeTruthy();
  });
});

describe("SCRUM-181/AC2 Venue Staff rename a layout type (181-S2)", () => {
  it("181-S2: edits the row in place and shows the new name", async () => {
    const send = api();
    render(<LayoutTypeManager initial={[THEATRE, BANQUET]} api={send} />);

    fireEvent.click(screen.getByRole("button", { name: "Rename Theatre" }));
    fireEvent.change(screen.getByLabelText("New name for Theatre"), { target: { value: "Lecture Theatre" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => expect(names()).toEqual(["Banquet", "Lecture Theatre"]));
    expect(send.rename).toHaveBeenCalledWith("l-theatre", "Lecture Theatre");
    expect(screen.getByRole("status").textContent).toContain('Renamed to "Lecture Theatre"');
  });

  it("181-S2: cancelling the rename sends nothing and keeps the name", () => {
    const send = api();
    render(<LayoutTypeManager initial={[THEATRE]} api={send} />);

    fireEvent.click(screen.getByRole("button", { name: "Rename Theatre" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(send.rename).not.toHaveBeenCalled();
    expect(names()).toEqual(["Theatre"]);
  });

  it("181-S2: changing only the case of its own name is allowed", async () => {
    const send = api({ rename: vi.fn().mockResolvedValue({ ok: true, data: { id: "l-theatre", name: "THEATRE" } }) });
    render(<LayoutTypeManager initial={[THEATRE]} api={send} />);

    fireEvent.click(screen.getByRole("button", { name: "Rename Theatre" }));
    fireEvent.change(screen.getByLabelText("New name for Theatre"), { target: { value: "THEATRE" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => expect(names()).toEqual(["THEATRE"]));
  });
});

describe("SCRUM-181/AC3 Venue Staff delete a layout type nothing uses (181-S3)", () => {
  it("181-S3: asks first, and removes the row only after the confirmation", async () => {
    const send = api();
    render(<LayoutTypeManager initial={[THEATRE, BANQUET]} api={send} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete Banquet" }));
    expect(send.remove).not.toHaveBeenCalled();
    expect(screen.getByText(/Delete .Banquet.\?/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete layout type" }));

    await waitFor(() => expect(names()).toEqual(["Theatre"]));
    expect(send.remove).toHaveBeenCalledWith("l-banquet");
    expect(screen.getByRole("status").textContent).toContain('Deleted "Banquet"');
  });

  it("181-S3: cancelling the confirmation deletes nothing", async () => {
    const send = api();
    render(<LayoutTypeManager initial={[THEATRE, BANQUET]} api={send} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete Banquet" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByText(/Delete .Banquet.\?/)).toBeNull());
    expect(send.remove).not.toHaveBeenCalled();
    expect(names()).toEqual(["Banquet", "Theatre"]);
  });
});

describe("SCRUM-181/AC4 a layout type in use cannot be deleted (181-S4)", () => {
  it("181-S4: shows the refusal and links to each venue that uses the type", async () => {
    const usedBy = { venues: [{ id: "v1", name: "Marina Bayview Hall A" }, { id: "v2", name: "Orchard Suite 2" }], eventCount: 0 };
    const send = api({
      remove: vi.fn().mockResolvedValue({ ok: false, data: { code: "LAYOUT_TYPE_IN_USE", error: "in use", usedBy } }),
    });
    render(<LayoutTypeManager initial={[THEATRE]} api={send} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete Theatre" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete layout type" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain('"Theatre" cannot be deleted because 2 venues use it: Marina Bayview Hall A, Orchard Suite 2.');
    expect(within(alert).getByRole("link", { name: "Marina Bayview Hall A" }).getAttribute("href")).toBe("/venues/v1");
    expect(within(alert).getByRole("link", { name: "Orchard Suite 2" }).getAttribute("href")).toBe("/venues/v2");
    expect(names()).toEqual(["Theatre"]);
  });

  it("181-S4: a type only event requests prefer is refused with the count and no link", async () => {
    const send = api({
      remove: vi.fn().mockResolvedValue({ ok: false, data: { code: "LAYOUT_TYPE_IN_USE", error: "in use", usedBy: { venues: [], eventCount: 1 } } }),
    });
    render(<LayoutTypeManager initial={[BANQUET]} api={send} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete Banquet" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete layout type" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain('"Banquet" cannot be deleted because 1 event request prefers it.');
    expect(within(alert).queryAllByRole("link")).toHaveLength(0);
  });

  it("181-S4: any other failure to delete is shown as it is, and the row stays", async () => {
    const send = api({ remove: vi.fn().mockResolvedValue({ ok: false, data: { error: "Only venue staff can delete a layout type." } }) });
    render(<LayoutTypeManager initial={[BANQUET]} api={send} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete Banquet" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete layout type" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Only venue staff can delete a layout type.");
    expect(names()).toEqual(["Banquet"]);
  });
});

describe("SCRUM-181/AC5 empty and duplicate names (181-S5)", () => {
  it.each([
    ["an empty name", "   ", "Enter a name for the layout type."],
    ["a name over 60 characters", "x".repeat(61), "The name can be at most 60 characters."],
    ["a name the list already has, ignoring case and spacing", " theatre ", "A layout type with that name already exists."],
  ])("181-S5: %s is refused on the field before anything is sent, and what was typed is kept", (_label, typed, message) => {
    const send = api();
    render(<LayoutTypeManager initial={[THEATRE]} api={send} />);

    fireEvent.change(screen.getByLabelText("New layout type"), { target: { value: typed } });
    fireEvent.click(screen.getByRole("button", { name: "Add layout type" }));

    expect(screen.getByText(message)).toBeTruthy();
    expect((screen.getByLabelText("New layout type") as HTMLInputElement).value).toBe(typed);
    expect(send.add).not.toHaveBeenCalled();
  });

  it("181-S5: a rename to another type's name is refused on its field before anything is sent", () => {
    const send = api();
    render(<LayoutTypeManager initial={[THEATRE, BANQUET]} api={send} />);

    fireEvent.click(screen.getByRole("button", { name: "Rename Banquet" }));
    fireEvent.change(screen.getByLabelText("New name for Banquet"), { target: { value: "THEATRE" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    expect(screen.getByText("A layout type with that name already exists.")).toBeTruthy();
    expect(send.rename).not.toHaveBeenCalled();
  });

  it("181-S5: a reason the server gives for the name is shown on the field, on add and on rename", async () => {
    const refuse = { ok: false, data: { error: "Some fields are invalid.", fieldErrors: { name: "A layout type with that name already exists." } } };
    const send = api({ add: vi.fn().mockResolvedValue(refuse), rename: vi.fn().mockResolvedValue(refuse) });
    render(<LayoutTypeManager initial={[BANQUET]} api={send} />);

    fireEvent.change(screen.getByLabelText("New layout type"), { target: { value: "Cabaret" } });
    fireEvent.click(screen.getByRole("button", { name: "Add layout type" }));
    expect(await screen.findByText("A layout type with that name already exists.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Rename Banquet" }));
    fireEvent.change(screen.getByLabelText("New name for Banquet"), { target: { value: "Gala" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(screen.getAllByText("A layout type with that name already exists.")).toHaveLength(2));
  });

  it("181-S5: a failure with no field shows its message above the list", async () => {
    const send = api({ add: vi.fn().mockResolvedValue({ ok: false, data: { error: "We couldn't reach the server. Please try again." } }) });
    render(<LayoutTypeManager initial={[]} api={send} />);

    fireEvent.change(screen.getByLabelText("New layout type"), { target: { value: "Cabaret" } });
    fireEvent.click(screen.getByRole("button", { name: "Add layout type" }));

    expect((await screen.findByRole("alert")).textContent).toContain("couldn't reach the server");
  });
});

describe("SCRUM-181/AC6 only venue staff (181-S6)", () => {
  it("181-S6: the Layout types page shows the manager to venue staff", async () => {
    canManageLayoutTypes.mockResolvedValue(true);
    getLayoutTypes.mockResolvedValue({ layoutTypes: [THEATRE] });

    render(await LayoutTypesPage());

    expect(screen.getByRole("heading", { name: "Layout types" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rename Theatre" })).toBeTruthy();
  });

  it("181-S6: anyone else who opens the address is told why they cannot manage, and nothing is loaded", async () => {
    canManageLayoutTypes.mockResolvedValue(false);
    getLayoutTypes.mockClear();

    render(await LayoutTypesPage());

    expect(screen.getByRole("alert").textContent).toBe("Only venue staff can manage layout types.");
    expect(screen.queryByRole("button", { name: "Add layout type" })).toBeNull();
    expect(getLayoutTypes).not.toHaveBeenCalled();
  });

  it("181-S6: a failure to load is shown instead of the manager", async () => {
    canManageLayoutTypes.mockResolvedValue(true);
    getLayoutTypes.mockResolvedValue({ error: "We couldn't load the layout types." });

    render(await LayoutTypesPage());

    expect(screen.getByRole("alert").textContent).toBe("We couldn't load the layout types.");
  });

  it("181-S6: a reply that is neither the list nor a reason gets a plain message", async () => {
    canManageLayoutTypes.mockResolvedValue(true);
    getLayoutTypes.mockResolvedValue(undefined);

    render(await LayoutTypesPage());

    expect(screen.getByRole("alert").textContent).toBe("Something went wrong. Please try again.");
  });

  it("181-S6: the catalogue offers 'Layout types' to venue staff", async () => {
    getVenues.mockResolvedValue({ venues: [{ id: "v1", name: "Orchid Hall", address: "Level 3", max_capacity: 150 }] });
    getVenueSearchOptions.mockResolvedValue({ error: "no" });
    canAddVenue.mockResolvedValue(true);

    render(await VenuesPage({}));

    expect(screen.getByRole("link", { name: "Layout types" }).getAttribute("href")).toBe("/venues/layout-types");
  });

  it("181-S6: a coordinator is not offered it", async () => {
    getVenues.mockResolvedValue({ venues: [{ id: "v1", name: "Orchid Hall", address: "Level 3", max_capacity: 150 }] });
    getVenueSearchOptions.mockResolvedValue({ error: "no" });
    canAddVenue.mockResolvedValue(false);

    render(await VenuesPage({}));

    expect(screen.queryByRole("link", { name: "Layout types" })).toBeNull();
  });

  it("181-S1: the venue form links to the layout types page, in a new tab so what was typed is not lost", () => {
    render(<VenueForm options={{ layouts: [{ id: "l1", name: "Theatre" }], facilities: [] }} />);

    const link = screen.getByRole("link", { name: "Manage layout types" });
    expect(link.getAttribute("href")).toBe("/venues/layout-types");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});

describe("SCRUM-181 the calls to venue-service", () => {
  it("181-S1: add posts the name with the session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "l1", name: "Cabaret" }) });
    vi.stubGlobal("fetch", fetchMock);

    expect(await postLayoutType("Cabaret")).toEqual({ ok: true, data: { id: "l1", name: "Cabaret" } });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/layout-types$/),
      expect.objectContaining({ method: "POST", credentials: "include", body: JSON.stringify({ name: "Cabaret" }) }),
    );
  });

  it("181-S2: rename patches the id, made safe for the address", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await patchLayoutType("a/b c", "Gala");

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/layout-types\/a%2Fb%20c$/);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ name: "Gala" }) });
  });

  it("181-S3: delete sends no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await deleteLayoutType("l1");

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "DELETE", body: undefined, headers: undefined });
  });

  it("181-S4: a refusal comes back with its reason and what uses the type", async () => {
    const body = { code: "LAYOUT_TYPE_IN_USE", error: "in use", usedBy: { venues: [], eventCount: 1 } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => body }));

    expect(await deleteLayoutType("l1")).toEqual({ ok: false, data: body });
  });

  it("181-S1: a server that cannot be reached is an error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const result = await postLayoutType("Cabaret");

    expect(result.ok).toBe(false);
    expect(result.data.error).toMatch(/couldn't reach the server/i);
  });
});
