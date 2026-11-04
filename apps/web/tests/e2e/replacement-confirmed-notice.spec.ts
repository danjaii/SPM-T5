import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// SCRUM-185/AC3 (docs/specs/replacement-confirmed-notice.md): needs the whole local stack (supabase start + seed, auth-service,
// event-service, venue-service, notification-service) and the service-role key to arrange throwaway fixtures; CI's e2e job has
// none of that. Opt in with E2E_FULL_STACK=1 and SUPABASE_URL + SUPABASE_SECRET_KEY set. Happy-path screenshots go to
// C:\dev\SPM-T5-screenshots\SCRUM-185-AC3\.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const PASSWORD = "ConnectSphere2026!";
const SHOTS = "C:\\dev\\SPM-T5-screenshots\\SCRUM-185-AC3";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";

test.describe.configure({ mode: "serial" });

const suffix = Math.random().toString(36).slice(2, 7);
const venueName = `IT-Replacement-${suffix}`;
const eventName = `IT-Replan Summit-${suffix}`;
let venueId = "";
let eventId = "";
let bookingId = "";

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
  const [rachel, organiser, staff, alicia] = await Promise.all([
    userId("rachel.tan@connectsphere.example.com"),
    userId("jason.chua@techconnect.example.com"),
    userId("kenneth.wong@connectsphere.example.com"),
    userId("alicia.fernandez@example.com"),
  ]);
  venueId = (await rest("venues", { method: "POST", body: JSON.stringify({ name: venueName, address: "1 Test Road", max_capacity: 200 }) }))[0].id;
  // an event a venue block returned to Planning (migration 82 leaves exactly this history row), with its replacement booking waiting
  eventId = (
    await rest("events", {
      method: "POST",
      body: JSON.stringify({ name: eventName, organiser_id: organiser, assigned_coordinator_id: rachel, status: "planning", is_draft: false, expected_attendance: 50 }),
    })
  )[0].id as string;
  await rest("event_status_history", {
    method: "POST",
    body: JSON.stringify({
      event_id: eventId,
      old_status: "confirmed",
      new_status: "planning",
      changed_by: staff,
      reason: "The original venue is unavailable, so the event was returned to Planning.",
      changed_at: new Date(Date.now() - 3_600_000).toISOString(),
    }),
  });
  bookingId = (
    await rest("venue_bookings", {
      method: "POST",
      body: JSON.stringify({
        event_id: eventId,
        venue_id: venueId,
        requested_by: rachel,
        status: "requested",
        event_start_datetime: "2031-11-14T01:00:00Z",
        event_end_datetime: "2031-11-14T09:00:00Z",
        snapshot_event_name: eventName,
        snapshot_expected_attendance: 50,
      }),
    })
  )[0].id as string;
  await rest("event_registrations", {
    method: "POST",
    body: JSON.stringify({ event_id: eventId, attendee_id: alicia, status: "registered", registration_details: { name: "Alicia Fernandez", email: "alicia.fernandez@example.com", phone: "+65 9123 4567" } }),
  });
});

test.afterAll(async () => {
  if (eventId) {
    await rest(`venue_bookings?event_id=eq.${eventId}`, { method: "DELETE" });
    await rest(`events?id=eq.${eventId}`, { method: "DELETE" }); // history, registrations and notifications cascade
  }
  if (venueId) await rest(`venues?id=eq.${venueId}`, { method: "DELETE" });
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

async function waitForButton(page: Page, name: string) {
  await page.waitForFunction((label) => {
    const el = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").startsWith(label));
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  }, name);
}

test.describe("SCRUM-185/AC3 replacement arrangements confirmed", () => {
  test("185-S3: Venue Staff approve the replacement venue, the last open arrangement, and the event moves on", async ({ page }) => {
    await signIn(page, "Venue Staff", "kenneth.wong@connectsphere.example.com", /\/dashboard\/venue_staff$/);
    await page.goto(`/booking-queue/${bookingId}`);
    await waitForButton(page, "Approve request");
    await page.screenshot({ path: `${SHOTS}\\01-staff-replacement-request.png`, fullPage: true });

    await page.getByRole("button", { name: "Approve request" }).click();
    await page.getByRole("button", { name: "Yes, approve" }).click();

    await expect.poll(async () => (await rest(`events?id=eq.${eventId}&select=status`))[0].status).toBe("awaiting_arrangements");
    await page.screenshot({ path: `${SHOTS}\\02-staff-approved.png`, fullPage: true });
  });

  test("185-S3: the organiser is told the arrangements are confirmed", async ({ page }) => {
    await signIn(page, "Event Organiser", "jason.chua@techconnect.example.com", /\/dashboard\/event_organiser$/);
    await page.goto("/notifications");

    const row = page.getByRole("listitem").filter({ hasText: eventName }).filter({ hasText: "Arrangements confirmed" });
    await expect(row).toContainText(`replacement arrangements are confirmed. Venue: ${venueName}.`);
    await expect(row).not.toContainText("Action needed");
    await page.screenshot({ path: `${SHOTS}\\03-organiser-notification.png`, fullPage: true });
  });

  test("185-S3: a registered attendee is told too", async ({ page }) => {
    await signIn(page, "Attendee", "alicia.fernandez@example.com", /\/dashboard\/attendee$/);
    await page.goto("/notifications");

    const row = page.getByRole("listitem").filter({ hasText: eventName }).filter({ hasText: "Arrangements confirmed" });
    await expect(row).toContainText("The event will be confirmed once its safety check is done.");
    await page.screenshot({ path: `${SHOTS}\\04-attendee-notification.png`, fullPage: true });
  });
});
