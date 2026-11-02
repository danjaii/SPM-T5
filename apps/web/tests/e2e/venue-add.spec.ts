import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// SCRUM-57: needs the whole local stack (supabase start + seed, auth-service, venue-service) and the service-role
// key to clean up the throwaway venue; CI's e2e job has none of that. Opt in with E2E_FULL_STACK=1 and
// SUPABASE_URL + SUPABASE_SECRET_KEY set. Happy-path screenshots go to C:\dev\SPM-T5-screenshots\SCRUM-57\.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const PASSWORD = "ConnectSphere2026!";
const SHOTS = "C:\\dev\\SPM-T5-screenshots\\SCRUM-57";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";

test.describe.configure({ mode: "serial" });

const venueName = `IT-57-Orchid-${Math.random().toString(36).slice(2, 7)}`;

const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", Prefer: "return=representation", ...init.headers },
  });

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

// The venue is made through the form, so it is found by its unique name and removed with its layouts and facilities.
test.afterAll(async () => {
  const found = await rest(`venues?name=eq.${encodeURIComponent(venueName)}&select=id`);
  for (const { id } of (await found.json()) as { id: string }[]) {
    await rest(`activity_log?entity_id=eq.${id}`, { method: "DELETE" });
    await rest(`venues?id=eq.${id}`, { method: "DELETE" });
  }
});

async function signIn(page: Page, role: string, email: string, dashboard: RegExp) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("combobox", { name: "Continue as" }).click();
  await page.getByRole("option", { name: role, exact: true }).click();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(dashboard);
}

// A value filled in before React hydrates the form is thrown away, so wait for the form to be live.
async function waitForVenueForm(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector("#name");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  });
}

test.describe("SCRUM-57 add a new venue", () => {
  test("AC2/AC1: staff are told what is missing, then add a venue that appears in the catalogue", async ({ page }) => {
    await signIn(page, "Venue Staff", "kenneth.wong@connectsphere.example.com", /\/dashboard\/venue_staff$/);
    await page.goto("/venues");
    await page.getByRole("link", { name: "Add venue" }).click();
    await expect(page).toHaveURL(/\/venues\/new$/);
    await waitForVenueForm(page);

    // 57-S2: only a location is given; the other required fields are named and nothing is created
    await page.getByLabel(/^Location/).fill("Level 3, 1 Raffles Place");
    await page.getByRole("button", { name: "Add venue" }).click();
    await expect(page.getByText("Enter the venue's name.")).toBeVisible();
    await expect(page.getByText(/Capacity must be a whole number/)).toBeVisible();
    await expect(page.getByText("Choose at least one supported layout.")).toBeVisible();
    await expect(page.getByLabel(/^Location/)).toHaveValue("Level 3, 1 Raffles Place");
    await page.screenshot({ path: `${SHOTS}\\01-missing-fields.png`, fullPage: true });

    // 57-S1: a complete venue is added and opens on its page
    await page.getByLabel(/^Name/).fill(venueName);
    await page.getByLabel(/^Capacity/).fill("150");
    await page.getByLabel("Opening time").fill("08:00");
    await page.getByLabel("Closing time").fill("22:00");
    await page.getByRole("checkbox", { name: "Accessible venue" }).click();
    await page.getByLabel("Accessibility notes").fill("Step-free entrance, hearing loop");
    await page.getByRole("checkbox", { name: "Theatre" }).click();
    await page.getByRole("checkbox", { name: "Projector & Screen" }).click();
    await page.screenshot({ path: `${SHOTS}\\02-filled-in.png`, fullPage: true });
    await page.getByRole("button", { name: "Add venue" }).click();

    await expect(page).toHaveURL(/\/venues\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: venueName })).toBeVisible();
    await expect(page.getByText("150 people")).toBeVisible();
    await expect(page.getByText("Projector & Screen")).toBeVisible();
    await expect(page.getByText("Theatre")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\03-new-venue-page.png`, fullPage: true });

    // it is in the catalogue straight away
    await page.goto("/venues");
    await expect(page.getByRole("link", { name: venueName })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\04-in-the-catalogue.png`, fullPage: true });
  });

  test("AC3: a coordinator is not offered the action and is told why on the page", async ({ page }) => {
    await signIn(page, "Event Coordinator", "rachel.tan@connectsphere.example.com", /\/dashboard\/event_coordinator$/);
    await page.goto("/venues");
    await expect(page.getByRole("link", { name: venueName })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add venue" })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}\\05-coordinator-no-button.png`, fullPage: true });

    await page.goto("/venues/new");
    await expect(page.getByRole("alert")).toHaveText("Only venue staff can add a venue.");
    await expect(page.getByRole("button", { name: "Add venue" })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}\\06-coordinator-told-why.png`, fullPage: true });
  });
});
