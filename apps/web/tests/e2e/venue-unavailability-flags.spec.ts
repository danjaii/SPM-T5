import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// SCRUM-106: needs the whole local stack (supabase start + seed, auth-service, event-service, venue-service,
// notification-service) and the service-role key to arrange throwaway fixtures; CI's e2e job has none of that. Opt in with
// E2E_FULL_STACK=1 and SUPABASE_URL + SUPABASE_SECRET_KEY set. Screenshots go to C:\dev\SPM-T5-screenshots\SCRUM-106\.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");
test.describe.configure({ mode: "serial" });

const PASSWORD = "ConnectSphere2026!";
const SHOTS = "C:\\dev\\SPM-T5-screenshots\\SCRUM-106";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
const LABEL = "Venue unavailable – alternative needed";

// The story's example, moved to 2031 so no seeded data is in the way. Singapore time throughout.
const suffix = Math.random().toString(36).slice(2, 7);
const venueName = `IT-Orchid-${suffix}`;
const approvedEventName = `IT-TechConf-${suffix}`;
const pendingEventName = `IT-Summit C-${suffix}`;
let venueId = "";
let approvedBooking = "";
let pendingBooking = "";
const eventIds: string[] = [];
const userIds: Record<string, string> = {};

const rest = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", Prefer: "return=representation", ...init.headers },
  });
  if (!res.ok) throw new Error(`${path}: ${await res.text()}`);
  return res.status === 204 ? [] : res.json();
};
const userId = async (email: string) => (await rest(`users?email=eq.${encodeURIComponent(email)}&select=id`))[0].id as string;

async function arrangeBooking(name: string, status: string, date: string, start: string, end: string) {
  const eventId = (
    await rest("events", {
      method: "POST",
      body: JSON.stringify({ name, organiser_id: userIds.organiser, assigned_coordinator_id: userIds.rachel, status: "approved", is_draft: false, expected_attendance: 50 }),
    })
  )[0].id as string;
  eventIds.push(eventId);
  return (
    await rest("venue_bookings", {
      method: "POST",
      body: JSON.stringify({
        event_id: eventId,
        venue_id: venueId,
        requested_by: userIds.rachel,
        status,
        event_start_datetime: `${date}T${start}:00+08:00`,
        event_end_datetime: `${date}T${end}:00+08:00`,
        snapshot_event_name: name,
        snapshot_expected_attendance: 50,
      }),
    })
  )[0].id as string;
}

test.beforeAll(async () => {
  test.skip(!SECRET, "set SUPABASE_SECRET_KEY to the local service-role key");
  mkdirSync(SHOTS, { recursive: true });
  userIds.rachel = await userId("rachel.tan@connectsphere.example.com");
  userIds.marcus = await userId("marcus.lim@connectsphere.example.com");
  userIds.organiser = await userId("jason.chua@techconnect.example.com");
  venueId = (await rest("venues", { method: "POST", body: JSON.stringify({ name: venueName, address: "1 Test Road", max_capacity: 200 }) }))[0].id;
  approvedBooking = await arrangeBooking(approvedEventName, "approved", "2031-11-14", "09:00", "17:00");
  pendingBooking = await arrangeBooking(pendingEventName, "requested", "2031-11-15", "09:00", "12:00");
});

test.afterAll(async () => {
  if (!SECRET) return;
  for (const id of eventIds) {
    await rest(`venue_bookings?event_id=eq.${id}`, { method: "DELETE" }); // flags and notifications cascade with the booking
    await rest(`events?id=eq.${id}`, { method: "DELETE" });
  }
  if (venueId) {
    await rest(`activity_log?entity_id=eq.${venueId}`, { method: "DELETE" });
    await rest(`venues?id=eq.${venueId}`, { method: "DELETE" });
  }
});

async function signIn(page: Page, role: RegExp, email: string, landing: RegExp) {
  await page.goto("/login");
  await page.waitForFunction(() => {
    const el = document.querySelector("input[type=password]");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  });
  await page.locator("label.role-option", { hasText: role }).click();
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(landing);
}
const signInAsStaff = (page: Page) => signIn(page, /Venue Staff/, "kenneth.wong@connectsphere.example.com", /\/dashboard\/venue_staff$/);
const signInAsRachel = (page: Page) => signIn(page, /Event Coordinator(?! Lead)/, "rachel.tan@connectsphere.example.com", /\/dashboard\/event_coordinator$/);

async function waitForForm(page: Page, selector: string) {
  await page.waitForFunction((css) => {
    const el = document.querySelector(css);
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  }, selector);
}

test.describe("SCRUM-106 flag bookings affected by venue unavailability", () => {
  test("106-S1 + 106-S3: Kenneth marks the venue unavailable and is told two bookings are affected", async ({ page }) => {
    await signInAsStaff(page);
    await page.goto(`/venues/${venueId}`);
    await waitForForm(page, "#unavailableStartDate");

    await page.getByLabel("Start date", { exact: true }).fill("2031-11-14");
    await page.getByLabel("Start time", { exact: true }).fill("08:00");
    await page.getByLabel("End date", { exact: true }).fill("2031-11-16");
    await page.getByLabel("End time", { exact: true }).fill("18:00");
    await page.getByLabel("Reason", { exact: true }).selectOption("maintenance");
    await page.screenshot({ path: `${SHOTS}\\01-unavailability-form.png`, fullPage: true });
    await page.getByRole("button", { name: "Mark unavailable" }).click();

    await expect(page.getByRole("status")).toContainText("2 bookings affected; their coordinators have been notified.");
    await page.screenshot({ path: `${SHOTS}\\02-staff-told-how-many.png`, fullPage: true });
  });

  test("106-S3: Kenneth sees the Pending request flagged, with Reject and no Approve", async ({ page }) => {
    await signInAsStaff(page);
    await page.goto(`/booking-queue/${pendingBooking}`);

    const banner = page.getByLabel("Flags");
    await expect(banner).toContainText(`Flagged: ${LABEL}`);
    await expect(banner).toContainText(`${venueName} is unavailable from 14 Nov 08:00 to 16 Nov 18:00 (Maintenance)`);
    await expect(page.getByRole("button", { name: "Approve request" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject request" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\03-queue-flagged-no-approve.png`, fullPage: true });
  });

  test("106-S2 + 106-S1: Rachel is notified, opens it, and lands on the flagged booking, which is still Approved", async ({ page }) => {
    await signInAsRachel(page);
    await expect(page.getByRole("link", { name: /^Notifications \(\d+ unread\)$/ })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\04-rachel-dashboard-unread.png`, fullPage: true });

    await page.goto("/notifications");
    await page.waitForFunction(() => {
      const el = document.querySelector("li.notification button");
      return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
    });
    const row = page.locator("li.notification", { hasText: approvedEventName });
    await expect(row).toContainText(LABEL);
    await expect(row).toContainText(`${approvedEventName}: your booking for ${venueName} on 14 Nov 09:00 to 17:00 is affected.`);
    await expect(row).toContainText("14 Nov 08:00 to 16 Nov 18:00 (Maintenance)");
    await expect(row).toContainText("Unread");
    await page.screenshot({ path: `${SHOTS}\\05-rachel-notification.png`, fullPage: true });

    await row.getByText(LABEL).click();

    await expect(page).toHaveURL(new RegExp(`/venue-bookings/${approvedBooking}$`));
    await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel("Flags")).toContainText(`${LABEL}: ${venueName} is unavailable from 14 Nov 08:00 to 16 Nov 18:00 (Maintenance)`);
    await page.screenshot({ path: `${SHOTS}\\06-flagged-booking-detail.png`, fullPage: true });
  });

  test("106-S5: nobody else was notified", async () => {
    for (const [who, id] of [["marcus", userIds.marcus], ["organiser", userIds.organiser]] as const) {
      const rows = await rest(`notifications?user_id=eq.${id}&type=eq.venue_booking_flagged&venue_booking_id=in.(${approvedBooking},${pendingBooking})&select=id`);
      expect(rows, who).toEqual([]);
    }
    // one notification per flagged booking, both for Rachel
    const hers = await rest(`notifications?user_id=eq.${userIds.rachel}&type=eq.venue_booking_flagged&venue_booking_id=in.(${approvedBooking},${pendingBooking})&select=id`);
    expect(hers).toHaveLength(2);
  });
});
