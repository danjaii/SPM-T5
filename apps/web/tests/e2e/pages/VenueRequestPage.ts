import type { Page } from "@playwright/test";
import { waitForHydration } from "../fixtures/hydration";

/** The coordinator's "Request a venue" form (apps/web/src/components/VenueBookingRequestForm.tsx). */
export class VenueRequestPage {
  constructor(private readonly page: Page) {}

  async open(eventId: string) {
    await this.page.goto(`/events/${eventId}/venue-request`);
    await waitForHydration(this.page, "#startTime"); // a value typed before hydration is thrown away
  }

  /** Fills the form. The venue's option reads "<name> (capacity <n>)". */
  async fill(opts: { venueName: string; capacity: number; date: string; start: string; end: string }) {
    await this.page.getByLabel("Venue", { exact: true }).selectOption({ label: `${opts.venueName} (capacity ${opts.capacity})` });
    await this.page.getByLabel("Date").fill(opts.date);
    await this.page.getByLabel("Start time").fill(opts.start);
    await this.page.getByLabel("End time").fill(opts.end);
  }

  async submit() {
    await this.page.getByRole("button", { name: "Submit request" }).click();
  }

  /**
   * The error message shown above the form after a refusal. Scoped to the form's section because Next.js puts its own,
   * invisible role="alert" (the route announcer) on every page.
   */
  get refusal() {
    return this.page.locator("section").getByRole("alert");
  }
}
