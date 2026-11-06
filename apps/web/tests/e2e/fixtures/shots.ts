import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";

// Screenshots of a case's happy path and main refusals, for the pull request and the Jira ticket. Opt in with E2E_SCREENSHOT_DIR
// (for example C:\dev\SPM-T5-screenshots\SCRUM-191): each shot is saved as <dir>/<case id>/<name>.png, and a later run overwrites
// the same names. Without the variable this does nothing, so the suite, and CI, behave exactly as before.
const DIR = process.env.E2E_SCREENSHOT_DIR;

interface ShotOptions {
  /** Runs first, only when screenshots are on: open or refresh the page that shows the result best. The test itself is unchanged. */
  prepare?: () => Promise<void>;
  /** Scrolled into view before the shot, for a message that sits below the fold. */
  focus?: Locator;
}

/** Saves the page as `<E2E_SCREENSHOT_DIR>/<caseId>/<name>.png`, if the variable is set. `name` starts with its number, e.g. "03-approved". */
export async function shot(page: Page, caseId: string, name: string, options: ShotOptions = {}): Promise<void> {
  if (!DIR) return;
  await options.prepare?.();
  await options.focus?.scrollIntoViewIfNeeded();
  const dir = join(DIR, caseId);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}
