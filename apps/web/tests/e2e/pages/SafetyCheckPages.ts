import type { Page } from "@playwright/test";
import { waitForHydration } from "../fixtures/hydration";

/** The Safety Officer's queue and review page (apps/web/src/components/SafetyCheckQueue.tsx, SafetyCheckActions.tsx). */
export class SafetyCheckPages {
  constructor(private readonly page: Page) {}

  /** Opens the queue ("Events waiting for a safety check") and returns the review link of one event. */
  async queueLink(eventName: string) {
    await this.page.goto("/safety-checks");
    return this.page.getByRole("link", { name: `Review ${eventName}` });
  }

  async openFromQueue(eventName: string) {
    await (await this.queueLink(eventName)).click();
    await this.page.getByRole("heading", { name: "Operational safety check" }).waitFor();
    await waitForHydration(this.page, "[role=radiogroup] button, [role=radio]"); // the radios must be live before they are clicked
  }

  /** Chooses an outcome (Approve, Request changes, Reject), types the reason or comments, and presses Submit decision. */
  async decide(outcome: "Approve" | "Request changes" | "Reject", comments?: string) {
    await this.page.getByRole("radio", { name: new RegExp(`^${outcome}`) }).click();
    if (comments !== undefined) await this.page.getByLabel(/Reason or comments|Comments \(optional\)/).fill(comments);
    await this.page.getByRole("button", { name: "Submit decision" }).click();
  }

  /** The confirmation after a decision: "Decision recorded: <label>, by <officer> on <date and time>". */
  get recorded() {
    return this.page.getByText(/^Decision recorded:/);
  }
}
