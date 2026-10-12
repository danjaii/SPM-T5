import { expect, test, type Page } from "@playwright/test";

// SCRUM-66: needs the whole local stack (supabase start + seed, auth-service, event-service), which CI's e2e job
// doesn't run. Opt in with E2E_FULL_STACK=1.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const PASSWORD = "ConnectSphere2026!";

// A value filled in before React hydrates the form is thrown away by hydration, so wait for the form to be live.
async function waitForForm(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector("#expectedAttendance");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  });
}

async function signInAsOrganiser(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("label.role-option", { hasText: /organiser/i }).click();
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard\/event_organiser$/);
}

test.describe("SCRUM-66/AC1 an organiser reaches the change request form from the dashboard", () => {
  test("clicking a planning event opens it with the change request form", async ({ page }) => {
    await signInAsOrganiser(page, "jason.chua@techconnect.example.com");

    const row = page.getByRole("row").filter({ hasText: "planning" }).first();
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
    await page.getByRole("row").filter({ hasText: "planning" }).first().getByRole("link").first().click();

    await waitForForm(page);
    const attendance = `${200 + Math.floor(Math.random() * 700)}`;
    await page.getByLabel("Expected attendance").fill(attendance);
    await page.getByRole("button", { name: "Submit change request" }).click();

    await expect(page.locator(".alert--ok")).toContainText("submitted for approval");
    await expect(page.getByRole("heading", { name: "Change requests" })).toBeVisible();
    await expect(page.locator(".status-badge", { hasText: "Pending" }).first()).toBeVisible();
  });
});

test.describe("SCRUM-66/AC10 the end date is shown and the end must be after the start", () => {
  test("a multi-day event shows its End date, and a same-day earlier end time is refused", async ({ page }) => {
    await signInAsOrganiser(page, "jason.chua@techconnect.example.com");
    await page.goto("/events/a57bcf0e-21a3-5da6-9d97-a495808f7332"); // planning, 17 Feb 09:00 to 18 Feb 17:00 (seed)
    await waitForForm(page);

    await expect(page.getByLabel("End date")).toHaveValue("2027-02-18");

    await page.getByLabel("End date").fill("2027-02-17");
    await page.getByLabel("End time").fill("08:00");
    await page.getByRole("button", { name: "Submit change request" }).click();

    await expect(page.getByText("End time must be after the start time.")).toBeVisible();
    await expect(page.locator(".alert--ok")).toHaveCount(0);
  });
});
