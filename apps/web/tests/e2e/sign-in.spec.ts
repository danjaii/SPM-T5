import { expect, test } from "@playwright/test";

// SCRUM-122: the sign-in page itself needs no backend, but signing in and the access-denied page need the local stack
// (supabase start + seed and auth-service), which CI's e2e job doesn't run. Opt in with E2E_FULL_STACK=1.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const PASSWORD = "ConnectSphere2026!";

test.describe("SCRUM-122 sign in", () => {
  test("SCRUM-122/AC1 a valid sign-in lands on the role's home page", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("alicia.fernandez@example.com");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("combobox", { name: "Continue as" }).click();
    await page.getByRole("option", { name: "Attendee" }).click();
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard\/attendee$/);
  });

  test("SCRUM-122/AC2 a wrong password shows an inline error and keeps the email", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("alicia.fernandez@example.com");
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("Work email")).toHaveValue("alicia.fernandez@example.com");
  });

  test("SCRUM-122/AC8 at 375px the page does not scroll sideways", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/login");
    const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, window: window.innerWidth }));
    expect(widths.page).toBeLessThanOrEqual(widths.window);
  });

  test("SCRUM-122/AC3 a signed-in attendee who opens another role's page sees access denied with a link home", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("alicia.fernandez@example.com");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("combobox", { name: "Continue as" }).click();
    await page.getByRole("option", { name: "Attendee" }).click();
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard\/attendee$/);

    await page.goto("/booking-queue");
    await expect(page.getByRole("heading", { name: /don't have access/i })).toBeVisible();
    await page.getByRole("link", { name: "Go to my home" }).click();
    await expect(page).toHaveURL(/\/dashboard\/attendee$/);
  });
});
