import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// SCRUM-101: needs the whole local stack (supabase start + seed, auth-service, venue-service) and the service-role
// key to arrange a throwaway venue; CI's e2e job has none of that. Opt in with E2E_FULL_STACK=1 and
// SUPABASE_URL + SUPABASE_SECRET_KEY set. Happy-path screenshots go to C:\dev\SPM-T5-screenshots\SCRUM-101\.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const PASSWORD = "ConnectSphere2026!";
const SHOTS = "C:\\dev\\SPM-T5-screenshots\\SCRUM-101";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";

test.describe.configure({ mode: "serial" });

let venueId = "";
const venueName = `IT-Orchid-${Math.random().toString(36).slice(2, 7)}`;

const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", Prefer: "return=representation", ...init.headers },
  });

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const res = await rest("venues", {
    method: "POST",
    body: JSON.stringify({ name: venueName, address: "1 Test Road", max_capacity: 100 }),
  });
  venueId = (await res.json())[0].id;
});

test.afterAll(async () => {
  if (venueId) {
    await rest(`activity_log?entity_id=eq.${venueId}`, { method: "DELETE" });
    await rest(`venues?id=eq.${venueId}`, { method: "DELETE" });
  }
});

async function signIn(page: Page, role: RegExp, email: string, dashboard: RegExp) {
  await page.goto("/login");
  await page.locator("label.role-option", { hasText: role }).click();
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(dashboard);
}

// A value filled in before React hydrates the form is thrown away, so wait for the form to be live.
async function waitForTimingForm(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector("#setupMinutes");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  });
}

test.describe("SCRUM-101 venue setup and turnaround times", () => {
  test("AC2/AC1/AC3: staff see 0 minutes, reject -15, then save 30 and 45", async ({ page }) => {
    await signIn(page, /Venue Staff/, "kenneth.wong@connectsphere.example.com", /\/dashboard\/venue_staff$/);
    await page.goto(`/venues/${venueId}`);
    await waitForTimingForm(page);

    // 101-S2: a new venue defaults to zero
    await expect(page.getByText("Setup time", { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText("0 minutes");
    await expect(page.getByText("Turnaround time", { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText("0 minutes");
    await page.screenshot({ path: `${SHOTS}\\01-defaults-zero.png`, fullPage: true });

    // 101-S3: -15 is refused and the saved values stay
    await page.getByLabel("Setup time (minutes)").fill("-15");
    await page.getByRole("button", { name: "Save times" }).click();
    await expect(page.getByText(/Setup time must be a whole number of minutes/)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\02-invalid-rejected.png`, fullPage: true });
    await page.reload();
    await expect(page.getByText("Setup time", { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText("0 minutes");

    // 101-S1: 30 and 45 are saved and shown
    await waitForTimingForm(page);
    await page.getByLabel("Setup time (minutes)").fill("30");
    await page.getByLabel("Turnaround time (minutes)").fill("45");
    await page.getByRole("button", { name: "Save times" }).click();
    await expect(page.getByRole("status")).toContainText("saved");
    await expect(page.getByText("Setup time", { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText("30 minutes");
    await expect(page.getByText("Turnaround time", { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText("45 minutes");
    await page.screenshot({ path: `${SHOTS}\\03-saved-30-45.png`, fullPage: true });
  });

  test("AC4: a coordinator sees the times and cannot edit them", async ({ page }) => {
    await signIn(page, /Event Coordinator(?! Lead)/, "rachel.tan@connectsphere.example.com", /\/dashboard\/event_coordinator$/);
    await page.goto(`/venues/${venueId}`);

    await expect(page.getByText("30 minutes")).toBeVisible();
    await expect(page.getByText("45 minutes")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save times" })).toHaveCount(0);
    await expect(page.getByLabel("Setup time (minutes)")).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}\\04-coordinator-read-only.png`, fullPage: true });
  });
});
