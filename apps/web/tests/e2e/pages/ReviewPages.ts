import { expect, type Page } from "@playwright/test";
import { waitForHydration } from "../fixtures/hydration";

/** The Lead's unassigned queue (apps/web/src/components/LeadQueueList.tsx, QueueAssignCell.tsx). */
export class LeadQueuePage {
  constructor(private readonly page: Page) {}

  async open() {
    await this.page.goto("/lead/queue");
  }

  /** Picks a coordinator for an event from its row's "Assign to…" list and confirms. */
  async assign(eventName: string, coordinatorName: string) {
    await waitForHydration(this.page, `[aria-label="Assign ${eventName} to"]`);
    await this.page.getByRole("combobox", { name: `Assign ${eventName} to` }).click();
    await this.page.getByRole("option", { name: new RegExp(coordinatorName) }).click();
    await this.page.getByRole("button", { name: `Confirm assigning ${eventName}` }).click();
  }

  row(eventName: string) {
    return this.page.getByRole("row").filter({ hasText: eventName });
  }
}

/** The coordinator's review of a submitted request, on the event page (EventStatusPanel.tsx, EventReviewActions.tsx). */
export class EventReviewPage {
  constructor(private readonly page: Page) {}

  async open(eventId: string) {
    await this.page.goto(`/events/${eventId}`);
  }

  async startReview() {
    await this.page.getByRole("button", { name: "Start review" }).click();
    await expect(this.page.getByRole("group", { name: "Review this request" })).toBeVisible();
  }

  async approve() {
    await this.page.getByRole("group", { name: "Review this request" }).getByRole("button", { name: "Approve request" }).click();
    await this.page.getByRole("dialog").getByRole("button", { name: "Approve request" }).click();
  }

  /** The stepper marks the current step with aria-current; the word for a status is printed for every step. */
  get currentStep() {
    return this.page.locator('[aria-current="step"]');
  }
}

/** The Lead's assign / reassign page (apps/web/src/components/LeadAssignForm.tsx, CoordinatorChoiceList.tsx). */
export class LeadAssignPage {
  constructor(private readonly page: Page) {}

  async open(eventId: string, kind: "assign" | "reassign") {
    await this.page.goto(`/lead/events/${eventId}/${kind}`);
    await waitForHydration(this.page, "[role=radio], button");
  }

  async choose(coordinatorName: string) {
    await this.page.getByRole("radio", { name: new RegExp(coordinatorName) }).click();
  }

  async confirm(kind: "assign" | "reassign") {
    await this.page.getByRole("button", { name: kind === "assign" ? "Confirm assignment" : "Confirm reassignment" }).click();
  }
}
