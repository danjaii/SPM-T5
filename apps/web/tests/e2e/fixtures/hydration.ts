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

/** The same wait for a button found by its label (its aria-label or its text), for a click that would otherwise be lost. */
export async function waitForButton(page: Page, label: string): Promise<void> {
  await page.waitForFunction((text) => {
    const el = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim().startsWith(text));
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  }, label);
}
