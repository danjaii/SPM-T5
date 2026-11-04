import { expect, type Page } from "@playwright/test";
import { waitForHydration } from "../fixtures/hydration";

/** The organiser's step-by-step "New event request" form (apps/web/src/components/event-request). */
export class EventRequestPage {
  constructor(private readonly page: Page) {}

  async open(draftId?: string) {
    await this.page.goto(draftId ? `/events/new?draft=${draftId}` : "/events/new");
    await waitForHydration(this.page, "#name");
  }

  async basics(v: { name: string; purpose: string; description: string }) {
    await this.page.getByLabel("Event name").fill(v.name);
    await this.page.getByLabel("Purpose", { exact: false }).fill(v.purpose);
    await this.page.getByLabel("Description", { exact: false }).fill(v.description);
  }

  /** `start`/`end` are "YYYY-MM-DDTHH:mm" in Singapore time, as a datetime-local box takes them. */
  async schedule(v: { start: string; end: string; attendance: number }) {
    await this.page.getByLabel("Starts").fill(v.start);
    await this.page.getByLabel("Ends").fill(v.end);
    await this.page.getByLabel("Expected attendance").fill(String(v.attendance));
  }

  async venueNeeds(v: { requirements: string; layout: string }) {
    await this.page.getByLabel("Venue requirements", { exact: false }).fill(v.requirements);
    await this.page.getByRole("combobox", { name: /Room layout/ }).click();
    await this.page.getByRole("option", { name: v.layout }).click();
  }

  async equipment(text: string) {
    await this.page.getByLabel("Equipment requirements", { exact: false }).fill(text);
  }

  async registration(v: { capacity: number; opens: string; closes: string }) {
    await this.page.getByRole("button", { name: "Yes, registration needed" }).click();
    await this.page.getByLabel("Registration capacity").fill(String(v.capacity));
    await this.page.getByLabel("Registration opens").fill(v.opens);
    await this.page.getByLabel("Registration closes").fill(v.closes);
  }

  async noRegistration() {
    await this.page.getByRole("button", { name: "No registration" }).click();
  }

  /** Presses "Continue to <next step>". */
  async continueTo(next: string) {
    await this.page.getByRole("button", { name: `Continue to ${next}` }).click();
    await expect(this.page.getByRole("heading", { level: 2, name: next })).toBeVisible();
  }

  async saveDraft() {
    await this.page.getByRole("button", { name: "Save as draft" }).click();
    await expect(this.page.getByRole("status").filter({ hasText: "Draft saved." })).toBeVisible();
  }

  async submit() {
    await this.page.getByRole("button", { name: "Submit request" }).click();
  }
}
