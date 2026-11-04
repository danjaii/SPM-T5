import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// SCRUM-185/AC1 (docs/specs/venue-block-reverts-event.md): needs the whole local stack (supabase start + seed, auth-service,
// event-service, venue-service, notification-service) and the service-role key to arrange throwaway fixtures; CI's e2e job has
// none of that. Opt in with E2E_FULL_STACK=1 and SUPABASE_URL + SUPABASE_SECRET_KEY set. Happy-path screenshots go to
// C:\dev\SPM-T5-screenshots\SCRUM-185-AC1\.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const PASSWORD = "ConnectSphere2026!";
const SHOTS = "C:\\dev\\SPM-T5-screenshots\\SCRUM-185-AC1";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";

test.describe.configure({ mode: "serial" });

const suffix = Math.random().toString(36).slice(2, 7);
const venueName = `IT-Revert-${suffix}`;
const eventName = `IT-Revert Summit-${suffix}`;
let venueId = "";
let eventId = "";

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
  const [rachel, organiser, officer] = await Promise.all([
    userId("rachel.tan@connectsphere.example.com"),
    userId("jason.chua@techconnect.example.com"),
    rest("users?role=eq.safety_officer&select=id&limit=1").then((r) => r[0].id as string),
  ]);
  venueId = (await rest("venues", { method: "POST", body: JSON.stringify({ name: venueName, address: "1 Test Road", max_capacity: 200 }) }))[0].id;
  // a Confirmed event with an Approved booking on 14 Nov 2031, 09:00 to 17:00 Singapore time, and its Safety Approval
  eventId = (
    await rest("events", {
      method: "POST",
      body: JSON.stringify({ name: eventName, organiser_id: organiser, assigned_coordinator_id: rachel, status: "confirmed", is_draft: false, expected_attendance: 50 }),
    })
  )[0].id as string;
  await rest("venue_bookings", {
    method: "POST",
    body: JSON.stringify({
      event_id: eventId,
      venue_id: venueId,
      requested_by: rachel,
      status: "approved",
      event_start_datetime: "2031-11-14T01:00:00Z",
      event_end_datetime: "2031-11-14T09:00:00Z",
      snapshot_event_name: eventName,
      snapshot_expected_attendance: 50,
    }),
  });
  await rest("safety_checks", { method: "POST", body: JSON.stringify({ event_id: eventId, decided_by: officer, decision: "approved" }) });
});

test.afterAll(async () => {
  if (eventId) {
    await rest(`venue_bookings?event_id=eq.${eventId}`, { method: "DELETE" });
    await rest(`events?id=eq.${eventId}`, { method: "DELETE" }); // history, safety checks and notifications cascade
  }
  if (venueId) {
    await rest(`activity_log?entity_id=eq.${venueId}`, { method: "DELETE" });
    await rest(`venues?id=eq.${venueId}`, { method: "DELETE" });
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
const signInAsStaff = (page: Page) => signIn(page, "Venue Staff", "kenneth.wong@connectsphere.example.com", /\/dashboard\/venue_staff$/);
const signInAsRachel = (page: Page) => signIn(page, "Event Coordinator", "rachel.tan@connectsphere.example.com", /\/dashboard\/event_coordinator$/);

// A value filled in before React hydrates the form is thrown away, so wait for the form to be live.
async function waitForLive(page: Page, selector: string) {
  await page.waitForFunction((css) => {
    const el = document.querySelector(css);
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  }, selector);
}

test.describe("SCRUM-185/AC1 a venue block returns a Confirmed event to Planning", () => {
  test("185-S1: before the block the event is Confirmed (the coordinator's view)", async ({ page }) => {
    await signInAsRachel(page);
    await page.goto(`/events/${eventId}`);

    await expect(page.getByRole("heading", { name: eventName }).first()).toBeVisible();
    await expect(page.getByText("Confirmed", { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\01-event-confirmed.png`, fullPage: true });
  });

  test("185-S1: Venue Staff block the venue over the booking and are told one booking is affected", async ({ page }) => {
    await signInAsStaff(page);
    await page.goto(`/venues/${venueId}`);
    await waitForLive(page, "button");

    await page.getByRole("button", { name: "Mark unavailable" }).click();
    const dialog = page.getByRole("dialog");
    await waitForLive(page, "#unavailableStartDate");
    await dialog.getByLabel("Start date", { exact: true }).fill("2031-11-14");
    await dialog.getByLabel("Start time", { exact: true }).fill("08:00");
    await dialog.getByLabel("End date", { exact: true }).fill("2031-11-16");
    await dialog.getByLabel("End time", { exact: true }).fill("18:00");
    await dialog.getByLabel("Reason", { exact: true }).selectOption("maintenance");
    await page.screenshot({ path: `${SHOTS}\\02-staff-block-form.png`, fullPage: true });
    await dialog.getByRole("button", { name: "Save unavailable period" }).click();

    await expect(dialog.getByRole("status")).toContainText("1 booking affected");
    await page.screenshot({ path: `${SHOTS}\\03-staff-block-saved.png`, fullPage: true });
    await expect.poll(async () => (await rest(`events?id=eq.${eventId}&select=status`))[0].status).toBe("planning");
  });

  test("185-S1: the coordinator sees the event back in Planning, kept, with the reason in its history", async ({ page }) => {
    await signInAsRachel(page);
    await page.goto(`/events/${eventId}`);

    await expect(page.getByRole("heading", { name: eventName }).first()).toBeVisible();
    await expect(page.getByText("Planning", { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\04-event-planning.png`, fullPage: true });
    const history = await rest(`event_status_history?event_id=eq.${eventId}&select=old_status,new_status,reason`);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ old_status: "confirmed", new_status: "planning" });
  });

  test("185-S1: the coordinator is told, with the action to take", async ({ page }) => {
    await signInAsRachel(page);
    await page.goto("/notifications");

    const row = page.getByRole("listitem").filter({ hasText: eventName }).filter({ hasText: "Event returned to Planning" });
    await expect(row).toContainText(`${venueName} is unavailable from 14 Nov 08:00 to 16 Nov 18:00 (Maintenance), so the event has been returned to Planning.`);
    await expect(row).toContainText("Action needed");
    await page.screenshot({ path: `${SHOTS}\\05-coordinator-notification.png`, fullPage: true });
  });
});
