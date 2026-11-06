import { expect, type Page } from "@playwright/test";
import { waitForHydration } from "../fixtures/hydration";

/** Venue Staff's decision on one request (apps/web/src/components/VenueStaffDecision.tsx), opened straight from the queue. */
export class BookingDecisionPage {
  constructor(private readonly page: Page) {}

  async open(bookingId: string) {
    await this.page.goto(`/booking-queue/${bookingId}`);
    await expect(this.page.getByRole("heading", { name: "Decision" })).toBeVisible();
    await waitForHydration(this.page, "button");
  }

  async approve() {
    await this.page.getByRole("button", { name: "Approve request" }).click();
    await this.page.getByRole("dialog").getByRole("button", { name: "Yes, approve" }).click();
  }

  /** Rejects with a reason and, optionally, a suggested alternative. */
  async reject(reason: string, suggestion?: { venueName: string; date: string; start: string; end: string }) {
    await this.page.getByRole("button", { name: "Reject request" }).click();
    const dialog = this.page.getByRole("dialog");
    await dialog.getByLabel("Reason for rejection").fill(reason);
    if (suggestion) {
      await dialog.getByRole("checkbox", { name: "Suggest an alternative" }).check();
      await dialog.getByLabel("Suggested venue").selectOption({ label: suggestion.venueName });
      await dialog.getByLabel("Suggested date").fill(suggestion.date);
      await dialog.getByLabel("Suggested start time").fill(suggestion.start);
      await dialog.getByLabel("Suggested end time").fill(suggestion.end);
    }
    await dialog.getByRole("button", { name: "Reject request" }).click();
    await expect(this.page.getByRole("dialog")).toHaveCount(0); // saved: the dialog closes
  }
}

/** The coordinator's view of an event's venue bookings, and changing or cancelling one (VenueBookingCard.tsx and friends). */
export class EventBookingsPage {
  constructor(private readonly page: Page) {}

  async open(eventId: string) {
    await this.page.goto(`/events/${eventId}?tab=venues`);
  }

  /** Cancel one venue booking, with the reason, through its confirmation. */
  async cancel(venueName: string, reason: string) {
    await waitForHydration(this.page, "button");
    await this.page.getByRole("button", { name: `Cancel the ${venueName} venue booking` }).click();
    const confirm = this.page.getByRole("alertdialog", { name: "Cancel venue booking" });
    await confirm.getByLabel("Reason for cancelling").fill(reason);
    await confirm.getByRole("button", { name: "Cancel venue booking", exact: true }).click();
  }

  async openChange(bookingId: string) {
    await this.page.goto(`/venue-bookings/${bookingId}/change`);
    await waitForHydration(this.page, "#startTime");
  }

  async change(v: { date?: string; start?: string; end?: string }) {
    if (v.date) await this.page.getByLabel("Date").fill(v.date);
    if (v.start) await this.page.getByLabel("Start time").fill(v.start);
    if (v.end) await this.page.getByLabel("End time").fill(v.end);
    await this.page.getByRole("button", { name: "Save change" }).click();
  }
}
