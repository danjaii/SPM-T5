import { utcToSgt } from "@spm-t5/shared";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryTable } from "@/components/equipment/InventoryTable";
import type { InventoryItemView } from "@/lib/equipmentInventory";
import { NAV_ITEMS } from "@/lib/nav";
import { canOpen, ROLE_ONLY_MATCHERS } from "@/lib/roleAccess";
import { config } from "@/middleware";

// Pretend loader, so the page tests are only about the page
const { getEquipmentInventory } = vi.hoisted(() => ({ getEquipmentInventory: vi.fn() }));
vi.mock("@/lib/equipmentInventoryServer", () => ({ getEquipmentInventory }));

import EquipmentInventoryPage from "@/app/equipment-inventory/page";
import Loading from "@/app/equipment-inventory/loading";

// ----------------------------------------------------------------------------
// Test setup: the inventory equipment-service sends for one period. 10 projectors with 4 held by Robotics Meetup,
// and 5 microphones that are damaged.
// ----------------------------------------------------------------------------

const item = (changes: Partial<InventoryItemView> = {}): InventoryItemView => ({
  id: "eq-projector",
  name: "Projector Unit",
  type: "AV",
  total: 10,
  available: 6,
  heldBy: [{ eventName: "Robotics Meetup", units: 4 }],
  outOfService: null,
  ...changes,
});

const mic = item({ id: "eq-mic", name: "Wireless Microphone", type: "Audio", total: 5, available: 0, heldBy: [], outOfService: "damaged" });

/** The table row that names this item. */
const row = (name: string) => screen.getByRole("row", { name: new RegExp(name) });

// end of test setup

describe("SCRUM-137/AC2 inventory leaves out units that cannot be used and says why", () => {
  it("counts reserved units out of the available number and names the events holding them", () => {
    render(<InventoryTable items={[item(), mic]} />);
    const projector = within(row("Projector Unit"));
    expect(projector.getByText("6 of 10")).toBeTruthy();
    expect(projector.getByText("Reserved", { selector: "[data-tone]" })).toBeTruthy();
    expect(projector.getByText("4 with Robotics Meetup")).toBeTruthy();
  });

  it("counts a damaged item as none available, labelled Damaged", () => {
    render(<InventoryTable items={[item(), mic]} />);
    const microphone = within(row("Wireless Microphone"));
    expect(microphone.getByText("0 of 5")).toBeTruthy();
    expect(microphone.getByText("Damaged", { selector: "[data-tone]" }).getAttribute("data-tone")).toBe("danger");
  });
});

describe("SCRUM-137/AC2 the inventory page", () => {
  const open = async (query: Record<string, string> = {}) => render(await EquipmentInventoryPage({ searchParams: Promise.resolve(query) }));

  beforeEach(() => getEquipmentInventory.mockReset());

  it("shows the inventory for the period in the address, with the period in the form", async () => {
    getEquipmentInventory.mockResolvedValue({ items: [item(), mic] });
    await open({ date: "2026-11-14", startTime: "08:00", endTime: "18:00" });

    expect(getEquipmentInventory).toHaveBeenCalledWith({ date: "2026-11-14", startTime: "08:00", endTime: "18:00" });
    expect(screen.getByRole("heading", { name: "Inventory" })).toBeTruthy();
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-11-14");
    expect(within(row("Wireless Microphone")).getByText("0 of 5")).toBeTruthy();
  });

  it("starts on today, 07:00 to 23:00 Singapore time, when no period is given", async () => {
    getEquipmentInventory.mockResolvedValue({ items: [] });
    await open();
    expect(getEquipmentInventory).toHaveBeenCalledWith({ date: utcToSgt(new Date()).date, startTime: "07:00", endTime: "23:00" });
  });
});

describe("SCRUM-137/AC9 inventory empty, loading and error states", () => {
  const open = async (query: Record<string, string> = {}) => render(await EquipmentInventoryPage({ searchParams: Promise.resolve(query) }));

  it("shows the page's shape, marked busy, while it loads", () => {
    render(<Loading />);
    expect(screen.getByRole("main").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("heading", { name: "Inventory" })).toBeTruthy();
  });

  it("shows a designed empty state for an empty catalogue", async () => {
    getEquipmentInventory.mockResolvedValue({ items: [] });
    await open();
    expect(screen.getByText("The equipment catalogue is empty.")).toBeTruthy();
  });

  it("shows equipment-service's refusal instead of the table", async () => {
    getEquipmentInventory.mockResolvedValue({ error: "Only Technical Support Staff can check equipment." });
    await open();
    expect(screen.getByRole("alert").textContent).toContain("Only Technical Support Staff can check equipment.");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("puts a problem with the period on its field", async () => {
    getEquipmentInventory.mockResolvedValue({ fieldErrors: { endTime: "The end time must be after the start time." } });
    await open({ date: "2026-11-14", startTime: "18:00", endTime: "08:00" });
    expect(screen.getByText("The end time must be after the start time.")).toBeTruthy();
    expect(screen.getByLabelText("End time").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("SCRUM-137/AC3,AC4 inventory in Technical Support Staff's navigation", () => {
  it("is a sidebar item for Technical Support Staff, one click from Home", () => {
    expect(NAV_ITEMS.technical_support_staff).toContainEqual(expect.objectContaining({ label: "Inventory", href: "/equipment-inventory" }));
  });

  it("is open only to Technical Support Staff, and the route guard covers it", () => {
    expect(canOpen("technical_support_staff", "/equipment-inventory")).toBe(true);
    expect(canOpen("event_coordinator", "/equipment-inventory")).toBe(false);
    expect(ROLE_ONLY_MATCHERS).toContain("/equipment-inventory/:path*");
    expect(config.matcher).toContain("/equipment-inventory/:path*");
  });
});
