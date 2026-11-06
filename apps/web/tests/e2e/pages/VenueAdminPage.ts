import { expect, type Page } from "@playwright/test";
import { waitForHydration } from "../fixtures/hydration";

/** Venue Staff's venue page: setup and turnaround times, and unavailable periods (VenueActions.tsx and its two forms). */
export class VenueAdminPage {
  constructor(private readonly page: Page) {}

  async open(venueId: string) {
    await this.page.goto(`/venues/${venueId}`);
    await waitForHydration(this.page, "button");
  }

  /** "Edit times": saves setup and turnaround minutes. Returns once the form says the times were saved. */
  async setTimes(setup: number, turnaround: number) {
    await this.page.getByRole("button", { name: "Edit times" }).click();
    const form = this.page.getByRole("form", { name: "Setup and turnaround times" });
    await form.getByLabel("Setup time (minutes)").fill(String(setup));
    await form.getByLabel("Turnaround time (minutes)").fill(String(turnaround));
    await form.getByRole("button", { name: "Save times" }).click();
    await expect(form.getByText(/The times were saved\./)).toBeVisible();
    return form;
  }

  /** "Mark unavailable": saves a block. `reason` is the option value, such as "maintenance". Returns the form with its result. */
  async markUnavailable(v: { startDate: string; startTime: string; endDate: string; endTime: string; reason: string }) {
    await this.page.getByRole("button", { name: "Mark unavailable" }).click();
    const form = this.page.getByRole("form", { name: "Mark this venue unavailable" });
    await form.getByLabel("Start date", { exact: true }).fill(v.startDate);
    await form.getByLabel("Start time", { exact: true }).fill(v.startTime);
    await form.getByLabel("End date", { exact: true }).fill(v.endDate);
    await form.getByLabel("End time", { exact: true }).fill(v.endTime);
    await form.getByLabel("Reason", { exact: true }).selectOption(v.reason);
    await form.getByRole("button", { name: "Save unavailable period" }).click();
    return form;
  }
}
