import type { Page } from "@playwright/test";

/**
 * A value typed or a click made before React has hydrated the element is thrown away, so wait until React has attached
 * its props to the first element matching `selector`. (Kept from the old specs, where it was copied into each file.)
 */
export async function waitForHydration(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  }, selector);
}
