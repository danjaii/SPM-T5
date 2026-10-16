import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// SCRUM-104: needs the whole local stack (supabase start + seed, auth-service, event-service, venue-service) and the
// service-role key to arrange throwaway fixtures; CI's e2e job has none of that. Opt in with E2E_FULL_STACK=1 and
// SUPABASE_URL + SUPABASE_SECRET_KEY set. Happy-path screenshots go to C:\dev\SPM-T5-screenshots\SCRUM-104\.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const PASSWORD = "ConnectSphere2026!";
const SHOTS = "C:\\dev\\SPM-T5-screenshots\\SCRUM-104";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
const DAY = "2031-11-14";
const SENTENCE = "Summit A (occupies until 12:45) now conflicts with Summit B (occupies from 12:00)";

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
  // Orchid Hall with setup 0 and turnaround 0
  venueId = (await rest("venues", { method: "POST", body: JSON.stringify({ name: venueName, address: "1 Test Road", max_capacity: 200 }) }))[0].id;
  const event = async (name: string, coordinator: string) =>
    (await rest("events", {
      method: "POST",
      body: JSON.stringify({ name: `IT-${name}-${suffix}`, organiser_id: organiser, assigned_coordinator_id: coordinator, status: "approved", is_draft: false, expected_attendance: 50 }),
    }))[0].id as string;
  summitA = await event("Summit A", marcus);
  summitB = await event("Summit B", rachel);
  const booking = (eventId: string, by: string, name: string, status: string, start: string, end: string) =>
    rest("venue_bookings", {
      method: "POST",
      body: JSON.stringify({
        event_id: eventId, venue_id: venueId, requested_by: by, status, snapshot_event_name: name, snapshot_expected_attendance: 50,
        event_start_datetime: `${DAY}T${start}:00Z`, event_end_datetime: `${DAY}T${end}:00Z`,
      }),
    });
  // Summit A: Approved 10:00-12:00 Singapore (02:00-04:00 UTC). Summit B: a Pending request for 12:30-14:00 (04:30-06:00 UTC).
  await booking(summitA, marcus, "Summit A", "approved", "02:00", "04:00");
  await booking(summitB, rachel, "Summit B", "requested", "04:30", "06:00");
});

test.afterAll(async () => {
  if (venueId) await rest(`activity_log?entity_id=eq.${venueId}`, { method: "DELETE" });
  for (const id of [summitA, summitB].filter(Boolean)) {
    await rest(`venue_bookings?event_id=eq.${id}`, { method: "DELETE" });
    await rest(`events?id=eq.${id}`, { method: "DELETE" });
  }
  if (venueId) await rest(`venues?id=eq.${venueId}`, { method: "DELETE" });
});

async function signIn(page: Page, role: RegExp, email: string, dashboard: RegExp) {
  await page.goto("/login");
  await page.locator("label.role-option", { hasText: role }).click();
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(dashboard);
}
const signInStaff = (page: Page) => signIn(page, /Venue Staff/, "kenneth.wong@connectsphere.example.com", /\/dashboard\/venue_staff$/);
const signInCoordinator = (page: Page) => signIn(page, /Event Coordinator(?! Lead)/, "rachel.tan@connectsphere.example.com", /\/dashboard\/event_coordinator$/);

// A value filled in before React hydrates the form is thrown away, so wait for the form to be live.
async function waitForTimingForm(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector("#setupMinutes");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  });
}

async function saveTimes(page: Page, setup: string, turnaround: string) {
  await page.goto(`/venues/${venueId}`);
  await waitForTimingForm(page);
  await page.getByLabel("Setup time (minutes)", { exact: true }).fill(setup);
  await page.getByLabel("Turnaround time (minutes)", { exact: true }).fill(turnaround);
  await page.getByRole("button", { name: "Save times" }).click();
}

const requestRow = (page: Page) => page.locator("tr", { hasText: venueName });

test.describe("SCRUM-104 bookings that conflict under new setup and turnaround times", () => {
  test("AC1: setup 30 and turnaround 45 show that Summit A now conflicts with Summit B", async ({ page }) => {
    await signInStaff(page);
    await saveTimes(page, "30", "45");

    await expect(page.getByRole("status")).toContainText("saved");
    await expect(page.getByText(SENTENCE)).toBeVisible();
    await expect(page.getByText(/Nothing was cancelled or withdrawn/)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\01-conflicts-shown-on-save.png`, fullPage: true });
  });

  test("AC3: the coordinator opens My venue bookings and sees the flag with the other booking's time", async ({ page }) => {
    await signInCoordinator(page);
    await page.getByRole("link", { name: "My venue bookings" }).click();

    const row = requestRow(page);
    await expect(row).toContainText("Buffer conflict: another booking at this venue, 10:00 to 12:00 on 14 Nov");
    await expect(row).not.toContainText("Summit A");
    await page.screenshot({ path: `${SHOTS}\\02-coordinator-sees-buffer-conflict.png`, fullPage: true });
  });

  test("AC4: Venue Staff open the flagged Pending request: no Approve, Reject is available", async ({ page }) => {
    await signInStaff(page);
    await page.goto("/booking-queue");
    await expect(requestRow(page)).toContainText("Flagged: Buffer conflict");
    await requestRow(page).getByRole("link", { name: /Summit B/ }).first().click();

    await expect(page.getByLabel("Flags")).toContainText("Flagged: Buffer conflict");
    await expect(page.getByLabel("Flags").getByRole("link")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve request" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject request" })).toBeVisible();
    await expect(page.getByText(/You can still reject it\./)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\03-flagged-request-no-approve.png`, fullPage: true });
  });

  test("AC5/AC6: setup 15 and turnaround 15 clear the flags; the request can be approved again", async ({ page }) => {
    await signInStaff(page);
    await saveTimes(page, "15", "15");

    await expect(page.getByRole("status")).toContainText("No existing bookings are affected.");
    await page.screenshot({ path: `${SHOTS}\\04-flags-cleared.png`, fullPage: true });

    await page.goto("/booking-queue");
    await expect(requestRow(page)).not.toContainText("Flagged");
    await requestRow(page).getByRole("link").first().click();
    await expect(page.getByRole("button", { name: "Approve request" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\05-approve-available-again.png`, fullPage: true });
  });

  test("AC2: both bookings were never withdrawn or cancelled (checked in the database)", async () => {
    const rows = (await rest(`venue_bookings?venue_id=eq.${venueId}&select=status,snapshot_event_name,withdrawn_at,cancelled_at`)) as {
      status: string; snapshot_event_name: string; withdrawn_at: string | null; cancelled_at: string | null;
    }[];
    expect(rows.find((r) => r.snapshot_event_name === "Summit A")).toMatchObject({ status: "approved", withdrawn_at: null, cancelled_at: null });
    expect(rows.find((r) => r.snapshot_event_name === "Summit B")).toMatchObject({ status: "requested", withdrawn_at: null, cancelled_at: null });
  });
});
