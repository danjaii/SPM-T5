import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EquipmentCatalogueItem } from "@spm-t5/shared";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), redirect: vi.fn() }));

// Pretend loading helpers, so the page tests are only about the page itself
const { getEquipmentCatalogue, canManageCatalogue } = vi.hoisted(() => ({
  getEquipmentCatalogue: vi.fn(),
  canManageCatalogue: vi.fn(),
}));
vi.mock("@/lib/equipmentCatalogueServer", () => ({ getEquipmentCatalogue, canManageCatalogue }));

import EquipmentCataloguePage from "@/app/equipment-catalogue/page";
import { EquipmentCatalogueManager } from "@/components/equipment/EquipmentCatalogueManager";
import { postEquipment, putEquipment } from "@/lib/equipmentCatalogue";
import { canOpen, ROLE_ONLY_MATCHERS } from "@/lib/roleAccess";

const PROJECTOR: EquipmentCatalogueItem = {
  id: "e-projector",
  name: "Projector Unit",
  type: "AV",
  description: "1080p ceiling projector.",
  totalQuantity: 10,
  location: "Central Equipment Store",
  operationalStatus: "available",
};
const CABLE: EquipmentCatalogueItem = {
  id: "e-cable",
  name: "Cable Reel",
  type: null,
  description: null,
  totalQuantity: 25,
  location: null,
  operationalStatus: "under_maintenance",
};

const api = (over: Partial<NonNullable<Parameters<typeof EquipmentCatalogueManager>[0]["api"]>> = {}) => ({
  add: vi.fn().mockResolvedValue({ ok: true, data: { id: "e-new" } }),
  edit: vi.fn().mockResolvedValue({ ok: true, data: { id: "e-projector" } }),
  ...over,
});

const names = () => within(screen.getByRole("list", { name: "Equipment catalogue" })).getAllByRole("listitem").map((li) => li.querySelector("p")?.textContent ?? "");
const addForm = () => within(screen.getByRole("form", { name: "Add equipment" }));

afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-182/AC1 technical support staff add equipment (182-S1)", () => {
  it("182-S1: sends the cleaned values, adds the item to the list in name order, and clears the form", async () => {
    const send = api();
    render(<EquipmentCatalogueManager initial={[PROJECTOR, CABLE]} api={send} />);

    const form = addForm();
    fireEvent.change(form.getByLabelText(/^Name/), { target: { value: "  Wireless   Mic " } });
    fireEvent.change(form.getByLabelText("Type"), { target: { value: "Audio" } });
    fireEvent.change(form.getByLabelText(/^Quantity/), { target: { value: " 6 " } });
    fireEvent.click(form.getByRole("button", { name: "Add equipment" }));

    await waitFor(() => expect(names()).toEqual(["Cable Reel", "Projector Unit", "Wireless Mic"]));
    expect(send.add).toHaveBeenCalledWith({
      name: "Wireless Mic",
      type: "Audio",
      description: null,
      totalQuantity: 6,
      location: null,
      operationalStatus: "available",
    });
    expect((addForm().getByLabelText(/^Name/) as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("status").textContent).toContain('Added "Wireless Mic"');
  });

  it("182-S1: the list shows each item's details, with its status as an icon and a label", () => {
    render(<EquipmentCatalogueManager initial={[PROJECTOR, CABLE]} api={api()} />);

    expect(screen.getByText("AV · 10 in total · Central Equipment Store")).toBeTruthy();
    expect(screen.getByText("1080p ceiling projector.")).toBeTruthy();
    expect(screen.getByText("25 in total")).toBeTruthy();
    expect(screen.getByText("Available")).toBeTruthy();
    expect(screen.getByText("Under maintenance")).toBeTruthy();
    expect(screen.getAllByTestId("status-icon")).toHaveLength(2);
  });

  it("182-S1: an empty catalogue says so", () => {
    render(<EquipmentCatalogueManager initial={[]} api={api()} />);

    expect(screen.getByText("There is no equipment in the catalogue yet.")).toBeTruthy();
  });
});

describe("SCRUM-182/AC2,AC3 technical support staff edit equipment and change its status (182-S2, S3)", () => {
  it("182-S2: opens the row's own values in the form and shows the new ones after saving", async () => {
    const send = api();
    render(<EquipmentCatalogueManager initial={[PROJECTOR, CABLE]} api={send} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Projector Unit" }));
    const form = within(screen.getByRole("form", { name: "Edit Projector Unit" }));
    expect((form.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("Projector Unit");
    expect((form.getByLabelText(/^Quantity/) as HTMLInputElement).value).toBe("10");
    expect((form.getByLabelText("Status") as HTMLSelectElement).value).toBe("available");
    fireEvent.change(form.getByLabelText(/^Quantity/), { target: { value: "12" } });
    fireEvent.click(form.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByText("AV · 12 in total · Central Equipment Store")).toBeTruthy());
    expect(send.edit).toHaveBeenCalledWith("e-projector", {
      name: "Projector Unit",
      type: "AV",
      description: "1080p ceiling projector.",
      totalQuantity: 12,
      location: "Central Equipment Store",
      operationalStatus: "available",
    });
    expect(screen.getByRole("status").textContent).toContain('Saved "Projector Unit"');
  });

  it("182-S3: marking an item under maintenance sends the new status and the row shows it", async () => {
    const send = api();
    render(<EquipmentCatalogueManager initial={[PROJECTOR]} api={send} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Projector Unit" }));
    const form = within(screen.getByRole("form", { name: "Edit Projector Unit" }));
    fireEvent.change(form.getByLabelText("Status"), { target: { value: "under_maintenance" } });
    fireEvent.click(form.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByText("Under maintenance")).toBeTruthy());
    expect(send.edit).toHaveBeenCalledWith("e-projector", expect.objectContaining({ operationalStatus: "under_maintenance" }));
    expect(screen.queryByText("Available")).toBeNull();
  });

  it("182-S3: the status choice offers all four statuses and says what a status other than Available means", () => {
    render(<EquipmentCatalogueManager initial={[PROJECTOR]} api={api()} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Projector Unit" }));

    const options = within(screen.getByLabelText("Status")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Available", "Damaged", "Under maintenance", "Retired"]);
    expect(screen.getByText(/not offered by the inventory, the availability check or a new reservation/)).toBeTruthy();
  });

  it("182-S2: cancelling the edit sends nothing and keeps the row", () => {
    const send = api();
    render(<EquipmentCatalogueManager initial={[PROJECTOR]} api={send} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Projector Unit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(send.edit).not.toHaveBeenCalled();
    expect(screen.queryByRole("form", { name: "Edit Projector Unit" })).toBeNull();
    expect(names()).toEqual(["Projector Unit"]);
  });

  it("182-S2: an item with no optional details shows its other details, and an edit sends them as blank", async () => {
    const send = api({ edit: vi.fn().mockResolvedValue({ ok: true, data: { id: "e-cable" } }) });
    render(<EquipmentCatalogueManager initial={[CABLE]} api={send} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Cable Reel" }));
    fireEvent.click(within(screen.getByRole("form", { name: "Edit Cable Reel" })).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(send.edit).toHaveBeenCalled());
    expect(send.edit).toHaveBeenCalledWith("e-cable", expect.objectContaining({ type: null, description: null, location: null }));
  });
});

describe("SCRUM-182/AC4 required and invalid fields (182-S4)", () => {
  it("182-S4: an empty form names every required field before anything is sent, and keeps what was typed", () => {
    const send = api();
    render(<EquipmentCatalogueManager initial={[PROJECTOR]} api={send} />);

    const form = addForm();
    fireEvent.change(form.getByLabelText("Type"), { target: { value: "Audio" } });
    fireEvent.click(form.getByRole("button", { name: "Add equipment" }));

    expect(screen.getByText("Enter the equipment's name.")).toBeTruthy();
    expect(screen.getByText(/Quantity must be a whole number from 1 to 100000/)).toBeTruthy();
    expect((addForm().getByLabelText("Type") as HTMLInputElement).value).toBe("Audio");
    expect(send.add).not.toHaveBeenCalled();
  });

  it("182-S4: a message goes away when its field is changed", () => {
    render(<EquipmentCatalogueManager initial={[]} api={api()} />);

    fireEvent.click(addForm().getByRole("button", { name: "Add equipment" }));
    expect(screen.getByText("Enter the equipment's name.")).toBeTruthy();
    fireEvent.change(addForm().getByLabelText(/^Name/), { target: { value: "Cable" } });

    expect(screen.queryByText("Enter the equipment's name.")).toBeNull();
  });

  it("182-S4: clearing a required field on an edit is refused on that field and nothing is sent", () => {
    const send = api();
    render(<EquipmentCatalogueManager initial={[PROJECTOR]} api={send} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Projector Unit" }));
    const form = within(screen.getByRole("form", { name: "Edit Projector Unit" }));
    fireEvent.change(form.getByLabelText(/^Name/), { target: { value: "  " } });
    fireEvent.click(form.getByRole("button", { name: "Save changes" }));

    expect(screen.getByText("Enter the equipment's name.")).toBeTruthy();
    expect(send.edit).not.toHaveBeenCalled();
  });

  it("182-S4: a reason the server gives for a field is shown on that field, on add and on edit", async () => {
    const refuse = { ok: false, data: { error: "Some fields are invalid.", fieldErrors: { location: "The location can be at most 120 characters." } } };
    const send = api({ add: vi.fn().mockResolvedValue(refuse), edit: vi.fn().mockResolvedValue(refuse) });
    render(<EquipmentCatalogueManager initial={[PROJECTOR]} api={send} />);

    fireEvent.change(addForm().getByLabelText(/^Name/), { target: { value: "Mic" } });
    fireEvent.change(addForm().getByLabelText(/^Quantity/), { target: { value: "3" } });
    fireEvent.click(addForm().getByRole("button", { name: "Add equipment" }));
    expect(await screen.findByText("The location can be at most 120 characters.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit Projector Unit" }));
    fireEvent.click(within(screen.getByRole("form", { name: "Edit Projector Unit" })).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getAllByText("The location can be at most 120 characters.")).toHaveLength(1));
    // neither refused save added a row or changed the one that is there
    expect(within(screen.getByRole("list", { name: "Equipment catalogue" })).getAllByRole("listitem")).toHaveLength(1);
  });

  it("182-S4: a failure with no field shows its message above the list, on add and on edit", async () => {
    const down = { ok: false, data: { error: "We couldn't reach the server. Please try again." } };
    const send = api({ add: vi.fn().mockResolvedValue(down), edit: vi.fn().mockResolvedValue({ ok: false, data: {} }) });
    render(<EquipmentCatalogueManager initial={[PROJECTOR]} api={send} />);

    fireEvent.change(addForm().getByLabelText(/^Name/), { target: { value: "Mic" } });
    fireEvent.change(addForm().getByLabelText(/^Quantity/), { target: { value: "3" } });
    fireEvent.click(addForm().getByRole("button", { name: "Add equipment" }));
    expect((await screen.findByRole("alert")).textContent).toContain("couldn't reach the server");

    fireEvent.click(screen.getByRole("button", { name: "Edit Projector Unit" }));
    fireEvent.click(within(screen.getByRole("form", { name: "Edit Projector Unit" })).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("We couldn't save the equipment"));
  });

  it("182-S4: a failure to add with no message gets a plain one", async () => {
    const send = api({ add: vi.fn().mockResolvedValue({ ok: false, data: {} }) });
    render(<EquipmentCatalogueManager initial={[]} api={send} />);

    fireEvent.change(addForm().getByLabelText(/^Name/), { target: { value: "Mic" } });
    fireEvent.change(addForm().getByLabelText(/^Quantity/), { target: { value: "3" } });
    fireEvent.click(addForm().getByRole("button", { name: "Add equipment" }));

    expect((await screen.findByRole("alert")).textContent).toContain("We couldn't add the equipment");
  });
});

describe("SCRUM-182/AC5 only technical support staff (182-S5)", () => {
  it("182-S5: the Equipment catalogue page shows the manager to technical support staff", async () => {
    canManageCatalogue.mockResolvedValue(true);
    getEquipmentCatalogue.mockResolvedValue({ items: [PROJECTOR] });

    render(await EquipmentCataloguePage());

    expect(screen.getByRole("heading", { name: "Equipment catalogue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Projector Unit" })).toBeTruthy();
  });

  it("182-S5: anyone else who opens the address is told why they cannot manage, and nothing is loaded", async () => {
    canManageCatalogue.mockResolvedValue(false);
    getEquipmentCatalogue.mockClear();

    render(await EquipmentCataloguePage());

    expect(screen.getByRole("alert").textContent).toBe("Only technical support staff can manage the equipment catalogue.");
    expect(screen.queryByRole("button", { name: "Add equipment" })).toBeNull();
    expect(getEquipmentCatalogue).not.toHaveBeenCalled();
  });

  it("182-S5: a failure to load is shown instead of the manager, and so is a reply with no reason", async () => {
    canManageCatalogue.mockResolvedValue(true);
    getEquipmentCatalogue.mockResolvedValue({ error: "We couldn't load the equipment catalogue." });
    const failed = render(await EquipmentCataloguePage());
    expect(screen.getByRole("alert").textContent).toBe("We couldn't load the equipment catalogue.");
    failed.unmount();

    getEquipmentCatalogue.mockResolvedValue(undefined);
    render(await EquipmentCataloguePage());
    expect(screen.getByRole("alert").textContent).toBe("Something went wrong. Please try again.");
  });

  it("182-S5: the route guard keeps every other role out of /equipment-catalogue", () => {
    expect(canOpen("technical_support_staff", "/equipment-catalogue")).toBe(true);
    for (const role of ["event_coordinator", "event_organiser", "venue_staff", "safety_officer", "attendee", "event_coordinator_lead"]) {
      expect(canOpen(role, "/equipment-catalogue")).toBe(false);
    }
    expect(ROLE_ONLY_MATCHERS).toContain("/equipment-catalogue/:path*");
  });
});

describe("SCRUM-182 the calls to equipment-service", () => {
  it("182-S1: add posts the values with the session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "e1" }) });
    vi.stubGlobal("fetch", fetchMock);
    const body = { name: "Mic", type: null, description: null, totalQuantity: 3, location: null };

    expect(await postEquipment(body)).toEqual({ ok: true, data: { id: "e1" } });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/equipment-catalogue$/),
      expect.objectContaining({ method: "POST", credentials: "include", body: JSON.stringify(body) }),
    );
  });

  it("182-S2: edit puts the item's id, made safe for the address, with its status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const body = { name: "Mic", type: null, description: null, totalQuantity: 3, location: null, operationalStatus: "damaged" as const };

    await putEquipment("a/b c", body);

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/equipment-catalogue\/a%2Fb%20c$/);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PUT", body: JSON.stringify(body) });
  });

  it("182-S4: a refusal comes back with its field messages", async () => {
    const reply = { error: "Some fields are invalid.", fieldErrors: { name: "Enter the equipment's name." } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => reply }));

    expect(await postEquipment({ name: "", type: null, description: null, totalQuantity: 3, location: null })).toEqual({ ok: false, data: reply });
  });

  it("182-S1: a server that cannot be reached is an error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const result = await postEquipment({ name: "Mic", type: null, description: null, totalQuantity: 3, location: null });

    expect(result.ok).toBe(false);
    expect(result.data.error).toMatch(/couldn't reach the server/i);
  });
});
