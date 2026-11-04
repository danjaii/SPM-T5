import { expect, type Page } from "@playwright/test";
import { waitForHydration } from "../fixtures/hydration";

/** The coordinator's "Find a venue" search, pre-filled from the event (apps/web/src/components/VenueCatalogue.tsx). */
export class VenueSearchPage {
  constructor(private readonly page: Page) {}

  /** From the event page: "Find a venue" opens the catalogue with the event's date, times and attendance already applied. */
  async openFromEvent(eventId: string) {
    await this.page.goto(`/events/${eventId}`);
    await this.page.getByRole("link", { name: "Find a venue" }).click();
    await expect(this.page).toHaveURL(new RegExp(`/venues\\?eventId=${eventId}`));
    await expect(this.page.getByText(/Filters are pre-filled from/)).toBeVisible();
  }

  /** The result card of a venue, if it was found. */
  result(venueName: string) {
    return this.page.getByRole("listitem").filter({ hasText: venueName });
  }

  get resultCount() {
    return this.page.getByText(/^\d+ venues? free$/);
  }
}

/** The venue staff's booking queue and decision (BookingQueueDetail.tsx, VenueStaffDecision.tsx). */
export class BookingQueuePage {
  constructor(private readonly page: Page) {}

  async open() {
    await this.page.goto("/booking-queue");
  }

  /** Opens the request that mentions this event (and venue) from the queue. */
  async openRequest(eventName: string) {
    await this.page.getByRole("link", { name: new RegExp(eventName) }).first().click();
    await expect(this.page.getByRole("heading", { name: "Decision" })).toBeVisible();
    await waitForHydration(this.page, "button");
  }

  async approve() {
    await this.page.getByRole("button", { name: "Approve request" }).click();
    await this.page.getByRole("dialog").getByRole("button", { name: "Yes, approve" }).click();
  }
}
