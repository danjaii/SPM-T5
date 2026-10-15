import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// SCRUM-110: needs the whole local stack (supabase start + seed, auth-service, event-service, venue-service), which CI's
// e2e job doesn't run. Opt in with E2E_FULL_STACK=1 and SUPABASE_URL / SUPABASE_SECRET_KEY (supabase status -o env).
// Fixtures are created with the service-role key and removed afterwards. Screenshots go to SHOTS.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const PASSWORD = "ConnectSphere2026!";
const SHOTS = "C:\\dev\\SPM-T5-screenshots\\SCRUM-110";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
const COORDINATOR = "rachel.tan@connectsphere.example.com"; // Event Coordinator
const STAFF = "kenneth.wong@connectsphere.example.com"; // Venue Staff
const REASON = "Organiser will run two smaller sessions";

const sgt = (date: string, time: string) => new Date(Date.parse(`${date}T${time}:00.000Z`) - 8 * 3600 * 1000).toISOString();

async function rest(method: string, path: string, body?: unknown): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return method === "DELETE" ? [] : ((await res.json()) as Record<string, unknown>[]);
}

async function signIn(page: Page, roleLabel: RegExp, email: string, landing: RegExp) {
  await page.goto("/login");
  await page.locator("label.role-option", { hasText: roleLabel }).click();
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(landing);
}

test.describe.serial("SCRUM-110 suitability when requesting a venue", () => {
  const ids = { events: [] as string[], venues: [] as string[] };
  let eventId = "";
  let orchidId = "";
  let lotusId = "";
  let breakoutId = "";
  let lotusName = "";

  const bookingCount = async () => (await rest("GET", `venue_bookings?select=id&event_id=eq.${eventId}`)).length;

  test.beforeAll(async () => {
    mkdirSync(SHOTS, { recursive: true });
    const [coordinator] = await rest("GET", `users?select=id&email=eq.${COORDINATOR}`);
    const [organiser] = await rest("GET", "users?select=id&role=eq.event_organiser&limit=1");
    const [theatre] = await rest("GET", "room_layouts?select=id&name=eq.Theatre&limit=1");
    const tag = Math.random().toString(36).slice(2, 7);

    // Orchid Hall suits TechConf (200 seats, Theatre). Lotus Room does not (60 seats, no Theatre).
    // Breakout Hall has 60 seats and Theatre: too small for 120, fine for a booking of 40 (Scenario 6).
    lotusName = `IT-Lotus Room ${tag}`;
    const [orchid] = await rest("POST", "venues", { name: `IT-Orchid Hall ${tag}`, address: "1 Test Road", max_capacity: 200 });
    const [lotus] = await rest("POST", "venues", { name: lotusName, address: "2 Test Road", max_capacity: 60 });
    const [breakout] = await rest("POST", "venues", { name: `IT-Breakout Hall ${tag}`, address: "3 Test Road", max_capacity: 60 });
    orchidId = orchid.id as string;
    lotusId = lotus.id as string;
    breakoutId = breakout.id as string;
    ids.venues.push(orchidId, lotusId, breakoutId);
    await rest("POST", "venue_supported_layouts", { venue_id: orchidId, room_layout_id: theatre.id, max_capacity_for_layout: 180 });
    await rest("POST", "venue_supported_layouts", { venue_id: breakoutId, room_layout_id: theatre.id, max_capacity_for_layout: 60 });

    const [event] = await rest("POST", "events", {
      name: `IT-TechConf 2026 ${tag}`,
      organiser_id: organiser.id,
      assigned_coordinator_id: coordinator.id,
      status: "approved",
      is_draft: false,
      expected_attendance: 120,
      preferred_room_layout_id: theatre.id,
      preferred_start_datetime: sgt("2031-11-14", "09:00"),
      preferred_end_datetime: sgt("2031-11-14", "12:00"),
    });
    eventId = event.id as string;
    ids.events.push(eventId);
  });

  test.afterAll(async () => {
    for (const id of ids.events) {
      await rest("PATCH", `venue_bookings?event_id=eq.${id}`, { amends_booking_id: null }).catch(() => []);
      await rest("DELETE", `venue_bookings?event_id=eq.${id}`);
      await rest("DELETE", `events?id=eq.${id}`);
    }
    for (const id of ids.venues) {
      await rest("DELETE", `venue_supported_layouts?venue_id=eq.${id}`);
      await rest("DELETE", `venues?id=eq.${id}`);
    }
  });

  const open = async (page: Page, venueId: string) => {
    await signIn(page, /coordinator/i, COORDINATOR, /\/dashboard\/event_coordinator$/);
    await page.goto(`/events/${eventId}/venue-request`);
    await page.getByLabel("Venue", { exact: true }).selectOption(venueId);
  };

  test("AC1 a suitable venue is requested with no warning (110-S1)", async ({ page }) => {
    await open(page, orchidId);
    await page.screenshot({ path: `${SHOTS}\\01-request-form-orchid-hall.png`, fullPage: true });
    await page.getByRole("button", { name: "Submit request" }).click();

    await expect(page).toHaveURL(/\/venue-bookings\/[0-9a-f-]+$/);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}\\02-orchid-hall-pending.png`, fullPage: true });
    // keep the event free for the next test
    await rest("DELETE", `venue_bookings?event_id=eq.${eventId}`);
  });

  test("AC2, AC3 an unsuitable venue warns, and Cancel creates nothing (110-S2, 110-S3)", async ({ page }) => {
    await open(page, lotusId);
    await page.getByRole("button", { name: "Submit request" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Expected attendance 120 exceeds capacity 60")).toBeVisible();
    await expect(dialog.getByText("Theatre not supported")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\03-warning-lotus-room.png`, fullPage: true });

    await dialog.getByRole("button", { name: "Submit anyway" }).click();
    await expect(dialog.getByText("Enter a reason to continue.")).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(await bookingCount()).toBe(0);
    await page.screenshot({ path: `${SHOTS}\\04-cancelled-nothing-created.png`, fullPage: true });
  });

  test("AC2, AC4 continuing with a reason creates a Not suitable request that venue staff see (110-S2, 110-S4)", async ({ page, browser }) => {
    await open(page, lotusId);
    await page.getByRole("button", { name: "Submit request" }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByLabel("Reason for requesting it anyway").fill(REASON);
    await dialog.getByRole("button", { name: "Submit anyway" }).click();

    await expect(page).toHaveURL(/\/venue-bookings\/([0-9a-f-]+)$/);
    const bookingId = page.url().split("/").pop()!;
    await page.screenshot({ path: `${SHOTS}\\05-lotus-room-pending-with-reason.png`, fullPage: true });

    const staff = await (await browser.newContext()).newPage();
    await signIn(staff, /venue/i, STAFF, /\/dashboard\/venue_staff$/);
    await staff.goto("/booking-queue");
    const row = staff.getByRole("row").filter({ hasText: lotusName });
    await expect(row.getByText("Not suitable")).toBeVisible();
    await staff.screenshot({ path: `${SHOTS}\\06-venue-staff-queue-not-suitable.png`, fullPage: true });

    await staff.goto(`/booking-queue/${bookingId}`);
    await expect(staff.getByText("Expected attendance 120 exceeds capacity 60").first()).toBeVisible();
    await expect(staff.getByText("Theatre not supported").first()).toBeVisible();
    await expect(staff.getByText(REASON)).toBeVisible();
    await staff.screenshot({ path: `${SHOTS}\\07-venue-staff-detail-unmet-and-reason.png`, fullPage: true });
  });

  test("AC5 an occupied venue is refused with no way to continue (110-S5)", async ({ page }) => {
    // the pending Lotus Room request above holds the slot, so a second booking of it for the same time is a clash
    await open(page, lotusId);
    await page.getByRole("button", { name: "Submit request" }).click();

    await expect(page.getByRole("alert").first()).toContainText(/already holds|already held/);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Submit anyway" })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}\\08-occupied-refused.png`, fullPage: true });
  });

  test("AC6 a multi-venue booking is checked on its own attendance (110-S6)", async ({ page }) => {
    // "Breakout A": 40 people at a 60-seat hall, although the event expects 120
    await open(page, breakoutId);
    await page.getByLabel("Expected attendance for this venue").fill("40");
    await page.getByRole("button", { name: "Check suitability" }).click();
    await expect(page.getByLabel("Venue suitability").getByText("Suitable", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\09-breakout-checked-on-own-attendance.png`, fullPage: true });

    await page.getByRole("button", { name: "Submit request" }).click();
    await expect(page).toHaveURL(/\/venue-bookings\/[0-9a-f-]+$/);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });
});
