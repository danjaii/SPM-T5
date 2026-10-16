import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// SCRUM-105: needs the whole local stack (supabase start + seed, auth-service, event-service, venue-service) and the
// service-role key to arrange throwaway fixtures; CI's e2e job has none of that. Opt in with E2E_FULL_STACK=1 and
// SUPABASE_URL + SUPABASE_SECRET_KEY set. Happy-path screenshots go to C:\dev\SPM-T5-screenshots\SCRUM-105\.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const PASSWORD = "ConnectSphere2026!";
const SHOTS = "C:\\dev\\SPM-T5-screenshots\\SCRUM-105";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
// The story's block, moved to 2031 so no seeded data gets in the way: 14 Nov 08:00 to 16 Nov 18:00.
const BLOCK_START_DATE = "2031-11-14";
const BLOCK_END_DATE = "2031-11-16";
const REFUSAL = (name: string) => `${name} is unavailable from 14 Nov 08:00 to 16 Nov 18:00`;

test.describe.configure({ mode: "serial" });

const suffix = Math.random().toString(36).slice(2, 7);
const venueName = `IT-Orchid-${suffix}`;
let venueId = "";
let summitB = "";

const rest = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", Prefer: "return=representation", ...init.headers },
  });
  if (!res.ok) throw new Error(`${path}: ${await res.text()}`);
  return res.status === 204 ? [] : res.json();
};
const userId = async (email: string) => (await rest(`users?email=eq.${encodeURIComponent(email)}&select=id`))[0].id as string;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const [rachel, organiser] = await Promise.all([userId("rachel.tan@connectsphere.example.com"), userId("jason.chua@techconnect.example.com")]);
  // Orchid Hall for this test: setup 30 (the story's scenario 5), no turnaround
  venueId = (await rest("venues", { method: "POST", body: JSON.stringify({ name: venueName, address: "1 Test Road", max_capacity: 200, setup_minutes: 30, turnaround_minutes: 0 }) }))[0].id;
  summitB = (
    await rest("events", {
      method: "POST",
      body: JSON.stringify({ name: `IT-Summit B-${suffix}`, organiser_id: organiser, assigned_coordinator_id: rachel, status: "approved", is_draft: false, expected_attendance: 50 }),
    })
  )[0].id as string;
});

test.afterAll(async () => {
  if (summitB) {
    await rest(`venue_bookings?event_id=eq.${summitB}`, { method: "DELETE" });
    await rest(`events?id=eq.${summitB}`, { method: "DELETE" });
  }
  if (venueId) {
    await rest(`activity_log?entity_id=eq.${venueId}`, { method: "DELETE" }); // each block is logged against its venue
    await rest(`venues?id=eq.${venueId}`, { method: "DELETE" }); // deletes its blocks too
  }
});

async function signIn(page: Page, role: RegExp, email: string, landing: RegExp) {
  await page.goto("/login");
  await page.locator("label.role-option", { hasText: role }).click();
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(landing);
}
const signInAsStaff = (page: Page) => signIn(page, /Venue Staff/, "kenneth.wong@connectsphere.example.com", /\/dashboard\/venue_staff$/);
const signInAsCoordinator = (page: Page) => signIn(page, /Event Coordinator(?! Lead)/, "rachel.tan@connectsphere.example.com", /\/dashboard\/event_coordinator$/);

// A value filled in before React hydrates the form is thrown away, so wait for the form to be live.
async function waitForForm(page: Page, selector: string) {
  await page.waitForFunction((css) => {
    const el = document.querySelector(css);
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  }, selector);
}

async function fillBlock(page: Page, values: { reason?: string; notes?: string; endDate?: string; endTime?: string }) {
  await page.getByLabel("Start date", { exact: true }).fill(BLOCK_START_DATE);
  await page.getByLabel("Start time", { exact: true }).fill("08:00");
  await page.getByLabel("End date", { exact: true }).fill(values.endDate ?? BLOCK_END_DATE);
  await page.getByLabel("End time", { exact: true }).fill(values.endTime ?? "18:00");
  if (values.reason) await page.getByLabel("Reason", { exact: true }).selectOption(values.reason);
  if (values.notes) await page.getByLabel("Notes", { exact: true }).fill(values.notes);
}

async function request(page: Page, date: string, start: string, end: string) {
  await page.goto(`/events/${summitB}/venue-request`);
  await waitForForm(page, "#startTime");
  await page.getByLabel("Venue", { exact: true }).selectOption({ label: `${venueName} (capacity 200)` });
  await page.getByLabel("Date").fill(date);
  await page.getByLabel("Start time").fill(start);
  await page.getByLabel("End time").fill(end);
  await page.getByRole("button", { name: "Submit request" }).click();
}

test.describe("SCRUM-105 mark a venue temporarily unavailable", () => {
  test("AC6: a coordinator opens the venue and has no way to mark it unavailable", async ({ page }) => {
    await signInAsCoordinator(page);
    await page.goto(`/venues/${venueId}`);

    await expect(page.getByRole("heading", { name: venueName })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Unavailable periods" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark unavailable" })).toHaveCount(0);
    await expect(page.getByLabel("Reason", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}\\01-coordinator-no-form.png`, fullPage: true });
  });

  test("AC2: submitting without a reason shows a message and saves nothing", async ({ page }) => {
    await signInAsStaff(page);
    await page.goto(`/venues/${venueId}`);
    await waitForForm(page, "#unavailableStartDate");

    await fillBlock(page, {});
    await page.getByRole("button", { name: "Mark unavailable" }).click();

    await expect(page.getByText("Choose a reason.")).toBeVisible();
    await expect(page.getByText("No upcoming unavailable periods.")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\02-reason-required.png`, fullPage: true });
  });

  test("AC3: an end that is not after the start shows a message and saves nothing", async ({ page }) => {
    await signInAsStaff(page);
    await page.goto(`/venues/${venueId}`);
    await waitForForm(page, "#unavailableStartDate");

    await fillBlock(page, { reason: "maintenance", endDate: BLOCK_START_DATE, endTime: "08:00" });
    await page.getByRole("button", { name: "Mark unavailable" }).click();

    await expect(page.getByText("The end must be after the start.")).toBeVisible();
    await expect(page.getByText("No upcoming unavailable periods.")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\03-end-after-start.png`, fullPage: true });
  });

  test("AC1: venue staff mark the venue unavailable and it is shown on the venue detail view", async ({ page }) => {
    await signInAsStaff(page);
    await page.goto(`/venues/${venueId}`);
    await waitForForm(page, "#unavailableStartDate");

    await fillBlock(page, { reason: "maintenance", notes: "Annual inspection" });
    await page.getByRole("button", { name: "Mark unavailable" }).click();

    await expect(page.getByRole("status")).toContainText("Marked unavailable from 14 Nov 08:00 to 16 Nov 18:00");
    await expect(page.getByText("14 Nov 08:00 to 16 Nov 18:00, Maintenance")).toBeVisible();
    await expect(page.getByText("Recorded by Kenneth Wong")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\04-marked-unavailable.png`, fullPage: true });
  });

  test("AC1: the day view shows the block as Unavailable", async ({ page }) => {
    await signInAsCoordinator(page);
    await page.goto(`/venues/${venueId}/availability?date=2031-11-15`);

    await expect(page.getByText(/^Unavailable 2031-11-14 08:00 to 2031-11-16 18:00 \(Maintenance\)$/)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\05-availability-unavailable.png`, fullPage: true });
  });

  test("AC4: a request inside the period is refused with the period in the message", async ({ page }) => {
    await signInAsCoordinator(page);
    await request(page, "2031-11-15", "09:00", "17:00");

    await expect(page.locator(".alert")).toContainText(REFUSAL(venueName));
    await expect(page.locator(".alert")).not.toContainText(/maintenance/i);
    await page.screenshot({ path: `${SHOTS}\\06-request-refused.png`, fullPage: true });
  });

  test("AC5: setup counts: 18:15-20:00 on the last day is refused, 18:30-20:00 is created Pending", async ({ page }) => {
    await signInAsCoordinator(page);
    await request(page, BLOCK_END_DATE, "18:15", "20:00");
    await expect(page.locator(".alert")).toContainText(REFUSAL(venueName));
    await page.screenshot({ path: `${SHOTS}\\07-setup-refused.png`, fullPage: true });

    await request(page, BLOCK_END_DATE, "18:30", "20:00");
    await expect(page).toHaveURL(/\/venue-bookings\/[0-9a-f-]+$/);
    await expect(page.getByText(/pending/i).first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\08-setup-created-pending.png`, fullPage: true });
  });
});
