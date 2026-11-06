import { expect, type Page } from "@playwright/test";
import { waitForButton, waitForHydration } from "../fixtures/hydration";

/** The attendee's way in: browse events, register, see and withdraw registrations. */
export class AttendeePages {
  constructor(private readonly page: Page) {}

  /**
   * Searches the event list (UpcomingEventList.tsx) and returns the card's Register button. The cards are not list items, so
   * the button is found by where it leads: that event's registration form.
   */
  async findRegisterButton(eventId: string, eventName: string) {
    await this.page.goto("/dashboard/attendee/browse");
    await this.page.getByRole("searchbox", { name: "Search events" }).fill(eventName);
    return this.page.locator(`a[href="/events/${eventId}/register"]`);
  }

  async register(v: { name: string; email: string; phone: string }) {
    await waitForHydration(this.page, "#name");
    await this.page.getByLabel("Name").fill(v.name);
    await this.page.getByLabel("Email").fill(v.email);
    await this.page.getByLabel("Contact number").fill(v.phone);
    await this.page.getByRole("button", { name: "Register" }).click();
  }

  /** The confirmation after registering. */
  get registered() {
    return this.page.getByRole("status").filter({ hasText: /You're registered for/ });
  }

  /** The event's row in "My registrations" (MyRegistrationList.tsx). */
  async row(eventName: string) {
    await this.page.goto("/registrations");
    return this.page.getByRole("row").filter({ hasText: eventName });
  }

  async withdraw(eventName: string) {
    const row = await this.row(eventName);
    await waitForButton(this.page, "Withdraw"); // the row's own button: a click before React has attached to it is lost
    await row.getByRole("button", { name: "Withdraw" }).click();
    const dialog = this.page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: `Withdraw from ${eventName}?` })).toBeVisible();
    // wait for the request to be accepted: the next step opens another page, and leaving now could cancel the request in flight
    const accepted = this.page.waitForResponse((r) => r.url().includes("/withdraw") && r.request().method() === "POST");
    await dialog.getByRole("button", { name: "Yes, withdraw" }).click();
    expect((await accepted).ok(), "the withdrawal was accepted").toBe(true);
  }
}
