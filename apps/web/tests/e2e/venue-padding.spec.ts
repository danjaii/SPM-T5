import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// SCRUM-103: needs the whole local stack (supabase start + seed, auth-service, event-service, venue-service) and the
// service-role key to arrange throwaway fixtures; CI's e2e job has none of that. Opt in with E2E_FULL_STACK=1 and
// SUPABASE_URL + SUPABASE_SECRET_KEY set. Happy-path screenshots go to C:\dev\SPM-T5-screenshots\SCRUM-103\.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const PASSWORD = "ConnectSphere2026!";
const SHOTS = "C:\\dev\\SPM-T5-screenshots\\SCRUM-103";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
const DAY = "2031-11-14";

test.describe.configure({ mode: "serial" });

const suffix = Math.random().toString(36).slice(2, 7);
const venueName = `IT-Orchid-${suffix}`;
let venueId = "";
let summitA = "";
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
  const [rachel, marcus, organiser] = await Promise.all([
    userId("rachel.tan@connectsphere.example.com"),
    userId("marcus.lim@connectsphere.example.com"),
    userId("jason.chua@techconnect.example.com"),
  ]);
  // Orchid Hall: setup 30, turnaround 45 (the customer's worked example)
  venueId = (await rest("venues", { method: "POST", body: JSON.stringify({ name: venueName, address: "1 Test Road", max_capacity: 200, setup_minutes: 30, turnaround_minutes: 45 }) }))[0].id;
  const event = async (name: string, coordinator: string) =>
    (await rest("events", {
      method: "POST",
      body: JSON.stringify({ name: `IT-${name}-${suffix}`, organiser_id: organiser, assigned_coordinator_id: coordinator, status: "approved", is_draft: false, expected_attendance: 50 }),
    }))[0].id as string;
  summitA = await event("Summit A", marcus);
  summitB = await event("Summit B", rachel);
  // Summit A: Approved at Orchid Hall on DAY, 10:00-12:00 Singapore time (02:00-04:00 UTC)
  await rest("venue_bookings", {
    method: "POST",
    body: JSON.stringify({ event_id: summitA, venue_id: venueId, requested_by: marcus, status: "approved", event_start_datetime: `${DAY}T02:00:00Z`, event_end_datetime: `${DAY}T04:00:00Z` }),
  });
});

test.afterAll(async () => {
  for (const id of [summitA, summitB].filter(Boolean)) {
    await rest(`venue_bookings?event_id=eq.${id}`, { method: "DELETE" });
    await rest(`events?id=eq.${id}`, { method: "DELETE" });
  }
  if (venueId) await rest(`venues?id=eq.${venueId}`, { method: "DELETE" });
});

async function signInAsCoordinator(page: Page) {
  await page.goto("/login");
  await page.locator("label.role-option", { hasText: /Event Coordinator(?! Lead)/ }).click();
  await page.getByLabel("Work email").fill("rachel.tan@connectsphere.example.com");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard\/event_coordinator$/);
}

// A value filled in before React hydrates the form is thrown away, so wait for the form to be live.
async function waitForForm(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector("#startTime");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  });
}

async function request(page: Page, start: string, end: string) {
  await page.goto(`/events/${summitB}/venue-request`);
  await waitForForm(page);
  await page.getByLabel("Venue", { exact: true }).selectOption({ label: `${venueName} (capacity 200)` });
  await page.getByLabel("Date").fill(DAY);
  await page.getByLabel("Start time").fill(start);
  await page.getByLabel("End time").fill(end);
  await page.getByRole("button", { name: "Submit request" }).click();
}

test.describe("SCRUM-103 setup and turnaround in availability and conflict checks", () => {
  test("AC5: availability shows Summit A occupying 09:30 to 12:45, with the event set apart", async ({ page }) => {
    await signInAsCoordinator(page);
    await page.goto(`/venues/${venueId}/availability?date=${DAY}`);

    await expect(page.getByText("Occupied 09:30 to 12:45")).toBeVisible();
    await expect(page.getByText("Setup 09:30 to 10:00")).toBeVisible();
    await expect(page.getByText("Event 10:00 to 12:00")).toBeVisible();
    await expect(page.getByText("Turnaround 12:00 to 12:45")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\01-availability-padded.png`, fullPage: true });
  });

  test("AC1: a request for 12:30-14:00 is refused with the occupied period", async ({ page }) => {
    await signInAsCoordinator(page);
    await request(page, "12:30", "14:00");

    await expect(page.locator(".alert")).toContainText(`${venueName} is occupied from 09:30 to 12:45, including setup and turnaround`);
    await page.screenshot({ path: `${SHOTS}\\02-request-refused.png`, fullPage: true });
  });

  test("AC2: a request for 13:15-15:00 (the padded periods only touch) is created as Pending", async ({ page }) => {
    await signInAsCoordinator(page);
    await request(page, "13:15", "15:00");

    await expect(page).toHaveURL(/\/venue-bookings\/[0-9a-f-]+$/);
    await expect(page.getByText(/pending/i).first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\03-request-created-pending.png`, fullPage: true });
  });
});
