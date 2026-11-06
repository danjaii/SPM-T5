import { expect, type Page } from "@playwright/test";
import { waitForHydration } from "../fixtures/hydration";

/** The organiser's "Request a change" form on the event's Change requests tab (EventChangeRequestForm.tsx). */
export class ChangeRequestFormPage {
  constructor(private readonly page: Page) {}

  async open(eventId: string) {
    await this.page.goto(`/events/${eventId}?tab=changes`);
    await expect(this.page.getByRole("heading", { name: "Request a change" })).toBeVisible();
    await waitForHydration(this.page, "#expectedAttendance");
  }

  async requestAttendance(n: number) {
    await this.page.getByLabel("Expected attendance").fill(String(n));
    await this.page.getByRole("button", { name: "Submit change request" }).click();
  }

  async requestVenueRequirements(text: string) {
    await this.page.getByLabel("Venue requirements").fill(text);
    await this.page.getByRole("button", { name: "Submit change request" }).click();
  }
}

/** The coordinator's decision on one change request (ChangeRequestReview.tsx). */
export class ChangeReviewPage {
  constructor(private readonly page: Page) {}

  async open(requestId: string) {
    await this.page.goto(`/change-requests/${requestId}`);
    await waitForHydration(this.page, "button");
  }

  async approve() {
    await this.page.getByRole("button", { name: "Approve", exact: true }).click();
    await this.page.getByRole("button", { name: "Confirm approval" }).click();
  }

  async reject(reason: string) {
    await this.page.getByRole("button", { name: "Reject", exact: true }).click();
    await this.page.getByLabel("Reason for rejecting").fill(reason);
    await this.page.getByRole("button", { name: "Confirm rejection" }).click();
  }
}
