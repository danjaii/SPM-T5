import type { Page } from "@playwright/test";

// `next dev` compiles a page when it is first opened, and with several workers that can take over a minute, so the page is not
// live until then. The production build in CI is quick; the limit only matters locally.
const HYDRATION_TIMEOUT = 90_000;

/**
 * A value typed or a click made before React has hydrated the element is thrown away, so wait until React has attached
 * its props to the first element matching `selector`. (Kept from the old specs, where it was copied into each file.)
 */
export async function waitForHydration(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  }, selector, { timeout: HYDRATION_TIMEOUT });
}

/** The same wait for a button found by its label (its aria-label or its text), for a click that would otherwise be lost. */
export async function waitForButton(page: Page, label: string): Promise<void> {
  await page.waitForFunction((text) => {
    const el = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim().startsWith(text));
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  }, label, { timeout: HYDRATION_TIMEOUT });
}
