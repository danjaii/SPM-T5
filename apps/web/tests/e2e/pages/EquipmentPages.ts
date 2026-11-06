import { expect, type Locator, type Page } from "@playwright/test";
import { waitForHydration } from "../fixtures/hydration";

interface Period { date: string; start: string; end: string }

/** "Check equipment availability" (apps/web/src/components/EquipmentAvailabilityForm.tsx, SCRUM-18). */
export class EquipmentAvailabilityPage {
  constructor(private readonly page: Page) {}

  /** Asks how many units are free in a period and returns the result the page shows. */
  async check(name: string, quantity: number, period: Period) {
    await this.page.goto("/equipment-availability");
    await waitForHydration(this.page, "#quantity");
    await this.page.getByLabel("Equipment name").fill(name);
    await this.page.getByLabel("Quantity required").fill(String(quantity));
    await this.page.getByLabel("Date").fill(period.date);
    await this.page.getByLabel("Start time").fill(period.start);
    await this.page.getByLabel("End time").fill(period.end);
    await this.page.getByRole("button", { name: "Check availability" }).click();
    // the result is the status region with an "Available" or "Insufficient" heading
    return this.page.getByRole("status").filter({ has: this.page.getByRole("heading", { level: 2 }) });
  }

  /** Asserts "<name>: <n> available" in the result and returns the heading text. */
  async expectAvailable(result: Locator, name: string, n: number) {
    await expect(result).toContainText(`${name}: ${n} available`);
  }
}

/** "Reserve equipment" (apps/web/src/components/EquipmentReservationForm.tsx, SCRUM-19). */
export class EquipmentReservationPage {
  constructor(private readonly page: Page) {}

  async open() {
    await this.page.goto("/equipment-reservation");
    await waitForHydration(this.page, "#quantity");
  }

  /** Picks the event and the equipment, enters the quantity and period, and presses Reserve equipment. */
  async reserve(opts: { eventName: string; equipmentName: string; quantity: number } & Period) {
    await this.page.getByRole("button", { name: new RegExp(`^${escape(opts.eventName)}`) }).click();
    await this.page.getByLabel("Search equipment").fill(opts.equipmentName);
    await this.page.getByRole("button", { name: opts.equipmentName, exact: true }).click();
    await this.page.getByLabel("Quantity required").fill(String(opts.quantity));
    await this.page.getByLabel("Date").fill(opts.date);
    await this.page.getByLabel("Start time").fill(opts.start);
    await this.page.getByLabel("End time").fill(opts.end);
    await this.page.getByRole("button", { name: "Reserve equipment" }).click();
  }

  /** The green confirmation after a successful reservation ("Reserved", with the quantity still available). */
  get confirmation() {
    return this.page.getByRole("status").filter({ has: this.page.getByRole("heading", { name: "Reserved" }) });
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
