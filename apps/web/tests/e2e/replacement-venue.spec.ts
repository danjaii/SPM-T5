import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// SCRUM-107: needs the whole local stack (supabase start + seed, auth-service, event-service, venue-service,
// notification-service) and the service-role key to arrange throwaway fixtures; CI's e2e job has none of that. Opt in with
// E2E_FULL_STACK=1 and SUPABASE_URL + SUPABASE_SECRET_KEY set. Screenshots go to C:\dev\SPM-T5-screenshots\SCRUM-107\.
// The seeded Gala has no replacement candidate (spec: "Seeded data cannot show this on its own"), so this arranges a throwaway
// Confirmed event with a flagged booking and three venues that are big enough.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");
test.describe.configure({ mode: "serial" });

// pages compile on first use under next dev, so give each assertion longer than the 5 s default
const slowExpect = expect.configure({ timeout: 30_000 });

const PASSWORD = "ConnectSphere2026!";
const SHOTS = "C:\\dev\\SPM-T5-screenshots\\SCRUM-107";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
const LABEL = "Venue unavailable – alternative needed";

const suffix = Math.random().toString(36).slice(2, 7);
const names = { orchid: `IT-Orchid-${suffix}`, lotus: `IT-Lotus-${suffix}`, maple: `IT-Maple-${suffix}` };
const eventName = `IT-TechConf-${suffix}`;
const ids: Record<string, string> = {};
let eventId = "";
let original = "";
let equipmentRequest = "";
let firstReplacement = "";
let secondReplacement = "";

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
  test.skip(!SECRET, "set SUPABASE_SECRET_KEY to the local service-role key");
  mkdirSync(SHOTS, { recursive: true });
  const [rachel, organiser] = await Promise.all([userId("rachel.tan@connectsphere.example.com"), userId("jason.chua@techconnect.example.com")]);
  for (const [key, name] of Object.entries(names)) {
    ids[key] = (await rest("venues", { method: "POST", body: JSON.stringify({ name, address: `1 ${key} Road`, max_capacity: 200 }) }))[0].id;
  }
  eventId = (
    await rest("events", {
      method: "POST",
      body: JSON.stringify({ name: eventName, organiser_id: organiser, assigned_coordinator_id: rachel, status: "confirmed", is_draft: false, expected_attendance: 120 }),
    })
  )[0].id;
  original = (
    await rest("venue_bookings", {
      method: "POST",
      body: JSON.stringify({
        event_id: eventId,
        venue_id: ids.orchid,
        requested_by: rachel,
        status: "approved",
        event_start_datetime: "2031-11-14T09:00:00+08:00",
        event_end_datetime: "2031-11-14T17:00:00+08:00",
        snapshot_event_name: eventName,
        snapshot_expected_attendance: 120,
      }),
    })
  )[0].id;
  const equipment = (await rest("equipment?select=id&limit=1"))[0].id;
  equipmentRequest = (
    await rest("equipment_reservations", {
      method: "POST",
      body: JSON.stringify({
        event_id: eventId,
        equipment_id: equipment,
        quantity_requested: 2,
        quantity_reserved: 2,
        status: "approved",
        requested_by: rachel,
        start_datetime: "2031-11-14T09:00:00+08:00",
        end_datetime: "2031-11-14T17:00:00+08:00",
        venue_booking_id: original,
      }),
    })
  )[0].id;
  // the block that makes it unavailable (SCRUM-105); its trigger flags the booking and notifies Rachel (SCRUM-106)
  await rest("venue_unavailability", {
    method: "POST",
    body: JSON.stringify({ venue_id: ids.orchid, start_datetime: "2031-11-14T08:00:00+08:00", end_datetime: "2031-11-16T18:00:00+08:00", reason: "maintenance" }),
  });
});

test.afterAll(async () => {
  if (!SECRET) return;
  if (eventId) {
    await rest(`equipment_reservations?event_id=eq.${eventId}`, { method: "DELETE" });
    // one statement, so the original and its replacement (which reference each other) go together
    await rest(`venue_bookings?event_id=eq.${eventId}`, { method: "DELETE" });
    await rest(`events?id=eq.${eventId}`, { method: "DELETE" });
  }
  for (const id of Object.values(ids)) {
    await rest(`venues?id=eq.${id}`, { method: "DELETE" }).catch(() => undefined);
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
  await slowExpect(page).toHaveURL(landing);
}
const signInAsStaff = (page: Page) => signIn(page, /Venue Staff/, "kenneth.wong@connectsphere.example.com", /\/dashboard\/venue_staff$/);
const signInAsRachel = (page: Page) => signIn(page, /Event Coordinator(?! Lead)/, "rachel.tan@connectsphere.example.com", /\/dashboard\/event_coordinator$/);

// a click before React hydrates the page does nothing, so wait for the first button to be live
async function waitForButtons(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector("main button");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  });
}

async function requestFrom(page: Page, venueName: string) {
  await page.goto(`/venue-bookings/${original}`);
  await page.getByRole("link", { name: "Find replacement" }).click();
  await slowExpect(page).toHaveURL(new RegExp(`/venue-bookings/${original}/replacement$`));
  await waitForButtons(page);
  await page.getByRole("button", { name: `Request ${venueName}` }).click();
  await slowExpect(page).toHaveURL(/\/venue-bookings\/[0-9a-f-]+$/);
  return page.url().split("/").pop() as string;
}

async function staffDecide(page: Page, id: string, decision: "approve" | "reject") {
  await signInAsStaff(page);
  await page.goto(`/booking-queue/${id}`);
  await waitForButtons(page);
  if (decision === "approve") {
    await page.getByRole("button", { name: "Approve request" }).click();
    await page.getByRole("button", { name: "Yes, approve" }).click();
  } else {
    await page.getByRole("button", { name: "Reject request" }).click();
    await page.getByLabel("Reason for rejection").fill("Booked out that day");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Yes, reject" }).click();
  }
  await slowExpect(page.getByRole("alertdialog")).toHaveCount(0);
}

test.describe("SCRUM-107 request a replacement venue for an affected booking", () => {
  test("107-S1: Rachel opens the flagged booking and Find replacement lists only free venues, never the original", async ({ page }) => {
    await signInAsRachel(page);
    await page.goto(`/venue-bookings/${original}`);
    await slowExpect(page.getByLabel("Flags")).toContainText(LABEL);
    await page.screenshot({ path: `${SHOTS}\\01-flagged-booking.png`, fullPage: true });

    await page.getByRole("link", { name: "Find replacement" }).click();

    await slowExpect(page.getByRole("heading", { name: "Find a replacement venue" })).toBeVisible();
    await slowExpect(page.getByRole("cell", { name: names.lotus, exact: true })).toBeVisible();
    await slowExpect(page.getByRole("cell", { name: names.maple, exact: true })).toBeVisible();
    await slowExpect(page.getByRole("cell", { name: names.orchid, exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}\\02-replacement-options.png`, fullPage: true });
  });

  test("107-S2 + 107-S5: requesting Lotus creates a Pending request; Find replacement then disappears", async ({ page }) => {
    await signInAsRachel(page);
    firstReplacement = await requestFrom(page, names.lotus);

    await slowExpect(page.getByText("Pending", { exact: true }).first()).toBeVisible();
    await slowExpect(page.getByText(new RegExp(`Replaces\\s*${names.orchid}`))).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\03-replacement-pending.png`, fullPage: true });

    await page.goto(`/venue-bookings/${original}`);
    await slowExpect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
    await slowExpect(page.getByLabel("Flags")).toContainText(LABEL);
    await slowExpect(page.getByText(/Replacement request waiting for a decision:/)).toBeVisible();
    await slowExpect(page.getByRole("link", { name: "Find replacement" })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}\\04-original-no-button.png`, fullPage: true });

    await page.goto(`/venue-bookings/${original}/replacement`);
    await slowExpect(page.locator(".alert")).toContainText("already has a replacement request waiting for a decision");
  });

  test("107-S4: Kenneth rejects it; the original is still flagged and Find replacement is back, without Lotus", async ({ page }) => {
    await staffDecide(page, firstReplacement, "reject");

    const rachel = await page.context().newPage();
    await rachel.context().clearCookies();
    await signInAsRachel(rachel);
    await rachel.goto(`/venue-bookings/${original}`);
    await slowExpect(rachel.getByLabel("Flags")).toContainText(LABEL);
    await rachel.getByRole("link", { name: "Find replacement" }).click();
    await slowExpect(rachel.getByRole("cell", { name: names.maple, exact: true })).toBeVisible();
    await slowExpect(rachel.getByRole("cell", { name: names.lotus, exact: true })).toHaveCount(0);
    await rachel.screenshot({ path: `${SHOTS}\\05-after-rejection-options.png`, fullPage: true });
  });

  test("107-S3: Maple is requested and approved; the original becomes Replaced, its flag reason stays, equipment follows", async ({ page }) => {
    await signInAsRachel(page);
    secondReplacement = await requestFrom(page, names.maple);

    await page.context().clearCookies();
    await staffDecide(page, secondReplacement, "approve");

    await page.context().clearCookies();
    await signInAsRachel(page);
    await page.goto(`/venue-bookings/${original}`);
    await slowExpect(page.getByText("Replaced", { exact: true }).first()).toBeVisible();
    await slowExpect(page.getByText(/^Replaced by/)).toContainText(names.maple);
    await slowExpect(page.getByRole("heading", { name: "Flag history" })).toBeVisible();
    await slowExpect(page.getByText(/resolved \(replaced by another venue\)/)).toBeVisible();
    await slowExpect(page.getByLabel("Flags")).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}\\06-original-replaced.png`, fullPage: true });

    await page.goto(`/events/${eventId}`);
    const section = page.getByRole("region", { name: "Venue bookings" });
    await slowExpect(section).toContainText(names.maple);
    await slowExpect(section).toContainText(`Replaced by ${names.maple}`);
    await page.screenshot({ path: `${SHOTS}\\07-event-shows-new-venue.png`, fullPage: true });

    const [equipment] = await rest(`equipment_reservations?id=eq.${equipmentRequest}&select=venue_booking_id,status,quantity_reserved`);
    expect(equipment).toMatchObject({ venue_booking_id: secondReplacement, status: "requested", quantity_reserved: null });
  });
});
