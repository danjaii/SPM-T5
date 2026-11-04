import { expect, type Page } from "@playwright/test";
import { waitForHydration } from "../fixtures/hydration";

/** An event's Equipment tab, where the coordinator adds an item (EventEquipmentRequests.tsx, EquipmentItemEditor.tsx). */
export class EventEquipmentPage {
  constructor(private readonly page: Page) {}

  async addItem(eventId: string, itemName: string, quantity: number) {
    await this.page.goto(`/events/${eventId}?tab=equipment`);
    await this.page.getByRole("button", { name: "Add item" }).click();
    const form = this.page.getByRole("form", { name: "Add equipment item" });
    await waitForHydration(this.page, "#quantity");
    await form.getByRole("combobox", { name: "Equipment" }).click();
    await this.page.getByRole("option", { name: new RegExp(itemName) }).click();
    await form.getByLabel("Quantity").fill(String(quantity));
    // the venue is chosen from the event's approved bookings
    const venue = form.getByRole("combobox", { name: "Venue" });
    if ((await venue.textContent())?.includes("Choose the venue")) {
      await venue.click();
      await this.page.getByRole("option").first().click();
    }
    await form.getByRole("button", { name: "Save" }).click();
    await expect(this.page.getByText("Equipment request added")).toBeVisible();
  }

  /** The item's row in the event's list, with its status. */
  row(itemName: string) {
    return this.page.getByRole("row").filter({ hasText: itemName });
  }
}

/** Technical Support's queue and review (EquipmentQueueList.tsx, EquipmentRequestReview.tsx). */
export class EquipmentQueuePage {
  constructor(private readonly page: Page) {}

  async open(eventId: string) {
    await this.page.goto(`/equipment-requests?event=${eventId}`);
  }

  /** Opens the item's request and moves it to a new status ("Arranged", "Cannot Fulfil", ...). */
  async setStatus(itemName: string, status: string) {
    await this.page.getByRole("link", { name: new RegExp(itemName) }).first().click();
    const form = this.page.getByRole("form", { name: "Update status" });
    await waitForHydration(this.page, "#review-status");
    await form.getByRole("combobox", { name: "New status" }).click();
    await this.page.getByRole("option", { name: status, exact: true }).click();
    await form.getByRole("button", { name: "Save status" }).click();
  }
}
