import { expect, test, type Page } from "@playwright/test";

// SCRUM-66: needs the whole local stack (supabase start + seed, auth-service, event-service), which CI's e2e job
// doesn't run. Opt in with E2E_FULL_STACK=1.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const PASSWORD = "ConnectSphere2026!";

async function signInAsOrganiser(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("label.role-option", { hasText: /organiser/i }).click();
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard\/event_organiser$/);
}

test.describe("SCRUM-66/AC1 an organiser reaches the change request form from the dashboard", () => {
  test("clicking a submitted event opens it with the change request form", async ({ page }) => {
    await signInAsOrganiser(page, "jason.chua@techconnect.example.com");

    const row = page.getByRole("row").filter({ hasText: "submitted" }).first();
    await row.getByRole("link").first().click();

    await expect(page).toHaveURL(/\/events\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: "Request a change" })).toBeVisible();
  });

  test("a draft event opens but offers no change request form", async ({ page }) => {
    await signInAsOrganiser(page, "jason.chua@techconnect.example.com");

    await page.getByRole("row").filter({ hasText: "draft" }).first().getByRole("link").first().click();

    await expect(page).toHaveURL(/\/events\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: "Request a change" })).toHaveCount(0);
  });

  test("submitting a change stores it as Pending (AC7)", async ({ page }) => {
    await signInAsOrganiser(page, "jason.chua@techconnect.example.com");
    await page.getByRole("row").filter({ hasText: "submitted" }).first().getByRole("link").first().click();

    const attendance = `${200 + Math.floor(Math.random() * 700)}`;
    await page.getByLabel("Expected attendance").fill(attendance);
    await page.getByRole("button", { name: "Submit change request" }).click();

    await expect(page.locator(".alert--ok")).toContainText("submitted for approval");
    await expect(page.getByRole("heading", { name: "Change requests" })).toBeVisible();
    await expect(page.locator(".status-badge", { hasText: "Pending" }).first()).toBeVisible();
  });
});
