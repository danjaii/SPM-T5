import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// SCRUM-185/AC2 (docs/specs/venue-block-lifting.md): needs the whole local stack (supabase start + seed, auth-service,
// event-service, venue-service) and the service-role key to arrange throwaway fixtures; CI's e2e job has none of that. Opt in with
// E2E_FULL_STACK=1 and SUPABASE_URL + SUPABASE_SECRET_KEY set. Happy-path screenshots go to C:\dev\SPM-T5-screenshots\SCRUM-185\.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const PASSWORD = "ConnectSphere2026!";
const SHOTS = "C:\\dev\\SPM-T5-screenshots\\SCRUM-185";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
const PERIOD = "14 Nov 08:00 to 16 Nov 18:00";

test.describe.configure({ mode: "serial" });

const suffix = Math.random().toString(36).slice(2, 7);
const venueName = `IT-Lift-${suffix}`;
const eventName = `IT-Lift Summit-${suffix}`;
let venueId = "";
let eventId = "";
let bookingId = "";
let blockId = "";

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
  venueId = (await rest("venues", { method: "POST", body: JSON.stringify({ name: venueName, address: "1 Test Road", max_capacity: 200 }) }))[0].id;
  eventId = (
    await rest("events", {
      method: "POST",
      body: JSON.stringify({ name: eventName, organiser_id: organiser, assigned_coordinator_id: rachel, status: "approved", is_draft: false, expected_attendance: 50 }),
    })
  )[0].id as string;
  // 14 Nov 2031, 09:00 to 17:00 Singapore time, inside the block below
  bookingId = (
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
    })
  )[0].id as string;
  // 14 Nov 08:00 to 16 Nov 18:00 Singapore time; the database flags the booking above and tells Rachel (SCRUM-106)
  blockId = (
    await rest("venue_unavailability", {
      method: "POST",
      body: JSON.stringify({ venue_id: venueId, start_datetime: "2031-11-14T00:00:00Z", end_datetime: "2031-11-16T10:00:00Z", reason: "maintenance", notes: "Annual inspection" }),
    })
  )[0].id as string;
});

test.afterAll(async () => {
  if (eventId) {
    await rest(`venue_bookings?event_id=eq.${eventId}`, { method: "DELETE" }); // flags and notifications cascade with the booking
    await rest(`events?id=eq.${eventId}`, { method: "DELETE" });
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

// A click made before React hydrates the page does nothing, so wait for the button to be live.
async function waitForButton(page: Page, name: string) {
  await page.waitForFunction((label) => {
    const el = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").startsWith(label));
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  }, name);
}

test.describe("SCRUM-185/AC2 lift a venue unavailability block", () => {
  test("185-S2c: a coordinator sees the block on the venue page and has no way to lift it", async ({ page }) => {
    await signInAsRachel(page);
    await page.goto(`/venues/${venueId}`);

    await expect(page.getByText(`${PERIOD}, Maintenance`)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Lift block/ })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}\\01-coordinator-no-lift.png`, fullPage: true });
  });

  test("185-S2: Venue Staff are asked to confirm, and keeping the block changes nothing", async ({ page }) => {
    await signInAsStaff(page);
    await page.goto(`/venues/${venueId}`);
    await waitForButton(page, "Lift block");

    await expect(page.getByText(`${PERIOD}, Maintenance`)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\02-staff-lift-button.png`, fullPage: true });
    await page.getByRole("button", { name: `Lift block ${PERIOD}` }).click();
    const confirm = page.getByRole("alertdialog", { name: "Confirm lifting this block" });
    await expect(confirm).toContainText("Coordinators with affected bookings will be told.");
    await page.screenshot({ path: `${SHOTS}\\03-staff-confirm.png`, fullPage: true });
    await confirm.getByRole("button", { name: "Keep block" }).click();

    await expect(confirm).toHaveCount(0);
    await expect(page.getByText(`${PERIOD}, Maintenance`)).toBeVisible();
    expect(await rest(`venue_unavailability?id=eq.${blockId}&select=id`)).toHaveLength(1);
  });

  test("185-S2: Venue Staff lift the block; it disappears and the flag is cleared", async ({ page }) => {
    await signInAsStaff(page);
    await page.goto(`/venues/${venueId}`);
    await waitForButton(page, "Lift block");
    expect(await rest(`venue_booking_flags?booking_id=eq.${bookingId}&resolved_at=is.null&select=id`)).toHaveLength(1);

    await page.getByRole("button", { name: `Lift block ${PERIOD}` }).click();
    await page.getByRole("button", { name: "Yes, lift block" }).click();

    await expect(page.getByText("No upcoming unavailable periods.")).toBeVisible();
    await expect(page.getByText("Unavailable period lifted. 1 coordinator has been notified.")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\04-staff-lifted.png`, fullPage: true });
    await expect.poll(async () => (await rest(`venue_unavailability?id=eq.${blockId}&select=id`)).length).toBe(0);
    expect(await rest(`venue_booking_flags?booking_id=eq.${bookingId}&select=id`)).toHaveLength(0);
    expect(await rest(`activity_log?entity_id=eq.${venueId}&action_type=eq.venue_unavailability_lifted&select=id`)).toHaveLength(1);
  });

  test("185-S2: Rachel is told the block is lifted and her booking is no longer affected", async ({ page }) => {
    await signInAsRachel(page);
    await page.goto("/notifications");

    const row = page.getByRole("listitem").filter({ hasText: eventName }).filter({ hasText: "Venue available again" });
    await expect(row).toContainText(`the unavailable period at ${venueName} (${PERIOD}, Maintenance) has been lifted`);
    await expect(row).toContainText("is no longer affected by it.");
    await expect(row.getByRole("button", { name: "Mark as read" })).toBeVisible(); // still unread
    await page.screenshot({ path: `${SHOTS}\\05-rachel-notification.png`, fullPage: true });
  });
});
