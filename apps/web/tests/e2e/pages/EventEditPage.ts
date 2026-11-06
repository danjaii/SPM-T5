import { expect, type Page } from "@playwright/test";
import { waitForHydration } from "../fixtures/hydration";

/** The coordinator's "Edit event details" form and its warning about affected arrangements (EventDetailsForm.tsx). */
export class EventEditPage {
  constructor(private readonly page: Page) {}

  async open(eventId: string) {
    await this.page.goto(`/events/${eventId}/edit`);
    await expect(this.page.getByRole("heading", { name: "Edit event details" })).toBeVisible();
    await waitForHydration(this.page, "input");
  }

  async setAttendance(n: number) {
    await this.page.getByLabel("Expected attendance").fill(String(n));
  }

  async save() {
    await this.page.getByRole("button", { name: "Save changes" }).click();
  }

  /** The dialog "Check affected arrangements" that appears before an important change is saved. */
  get warning() {
    return this.page.getByRole("dialog");
  }

  get affected() {
    return this.warning.getByTestId("affected-item");
  }

  async goBack() {
    await this.warning.getByRole("button", { name: "Go back" }).click();
    await expect(this.warning).toHaveCount(0);
  }

  async saveAnyway() {
    await this.warning.getByRole("button", { name: "Save anyway" }).click();
  }
}
