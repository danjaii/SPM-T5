import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

// Screenshots of a case's happy path and main refusals, for the pull request and the Jira ticket. Opt in with E2E_SCREENSHOT_DIR
// (for example C:\dev\SPM-T5-screenshots\SCRUM-191): each shot is saved as <dir>/<case id>/<name>.png, and a later run overwrites
// the same names. Without the variable this does nothing, so the suite, and CI, behave exactly as before.
const DIR = process.env.E2E_SCREENSHOT_DIR;

/** Saves the page as `<E2E_SCREENSHOT_DIR>/<caseId>/<name>.png`, if the variable is set. `name` starts with its number, e.g. "03-approved". */
export async function shot(page: Page, caseId: string, name: string): Promise<void> {
  if (!DIR) return;
  const dir = join(DIR, caseId);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}
