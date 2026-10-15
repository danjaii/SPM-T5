import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// SCRUM-109: needs the whole local stack (supabase start + seed, auth-service, event-service, venue-service), which
// CI's e2e job doesn't run. Opt in with E2E_FULL_STACK=1 and SUPABASE_URL / SUPABASE_SECRET_KEY (supabase status -o env).
// Fixtures are created with the service-role key and removed afterwards. Screenshots go to SHOTS.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const PASSWORD = "ConnectSphere2026!";
const SHOTS = "C:\\dev\\SPM-T5-screenshots\\SCRUM-109";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
const COORDINATOR = "rachel.tan@connectsphere.example.com"; // Event Coordinator
const STAFF = "kenneth.wong@connectsphere.example.com"; // Venue Staff

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

test.describe.serial("SCRUM-109 a venue is checked against an event", () => {
  const ids = { events: [] as string[], venues: [] as string[], bookings: [] as string[] };
  let eventId = "";
  let orchidId = "";
  let lotusId = "";
  let bookingId = "";

  test.beforeAll(async () => {
    mkdirSync(SHOTS, { recursive: true });
    const [coordinator] = await rest("GET", `users?select=id&email=eq.${COORDINATOR}`);
    const [organiser] = await rest("GET", "users?select=id&role=eq.event_organiser&limit=1");
    const [theatre] = await rest("GET", "room_layouts?select=id&name=eq.Theatre&limit=1");
    const tag = Math.random().toString(36).slice(2, 7);

    // "Orchid Hall": 200 seats, Theatre, open 08:00-22:00. "Lotus Room": 60 seats, no Theatre.
    const [orchid] = await rest("POST", "venues", { name: `IT-Orchid Hall ${tag}`, address: "1 Test Road", max_capacity: 200, operating_hours_start: "08:00", operating_hours_end: "22:00", is_accessible: true });
    const [lotus] = await rest("POST", "venues", { name: `IT-Lotus Room ${tag}`, address: "2 Test Road", max_capacity: 60, operating_hours_start: "08:00", operating_hours_end: "22:00" });
    orchidId = orchid.id as string;
    lotusId = lotus.id as string;
    ids.venues.push(orchidId, lotusId);
    await rest("POST", "venue_supported_layouts", { venue_id: orchidId, room_layout_id: theatre.id, max_capacity_for_layout: 180 });

    const [event] = await rest("POST", "events", {
      name: `IT-TechConf 2026 ${tag}`,
      organiser_id: organiser.id,
      assigned_coordinator_id: coordinator.id,
      status: "approved",
      is_draft: false,
      expected_attendance: 120,
      preferred_room_layout_id: theatre.id,
      accessibility_requirements: "Stage must face the windows",
      preferred_start_datetime: sgt("2031-11-14", "09:00"),
      preferred_end_datetime: sgt("2031-11-14", "12:00"),
    });
    eventId = event.id as string;
    ids.events.push(eventId);

    // A pending request for Lotus Room, for the Venue Staff view.
    const [booking] = await rest("POST", "venue_bookings", {
      event_id: eventId,
      venue_id: lotusId,
      requested_by: coordinator.id,
      status: "requested",
      event_start_datetime: sgt("2031-11-14", "09:00"),
      event_end_datetime: sgt("2031-11-14", "12:00"),
    });
    bookingId = booking.id as string;
    ids.bookings.push(bookingId);
  });

  test.afterAll(async () => {
    for (const id of ids.bookings) await rest("DELETE", `venue_bookings?id=eq.${id}`);
    for (const id of ids.events) await rest("DELETE", `events?id=eq.${id}`);
    for (const id of ids.venues) {
      await rest("DELETE", `venue_supported_layouts?venue_id=eq.${id}`);
      await rest("DELETE", `venues?id=eq.${id}`);
    }
  });

  test("AC1 a suitable venue: Orchid Hall (109-S1, 109-S6)", async ({ page }) => {
    // Checking only reads, so the request form stays usable although the event already has a pending request.
    await signIn(page, /Event Coordinator(?! Lead)/, COORDINATOR, /\/dashboard\/event_coordinator$/);
    await page.goto(`/events/${eventId}/venue-request`);
    await page.getByLabel("Venue", { exact: true }).selectOption(orchidId);
    await page.getByRole("button", { name: "Check suitability" }).click();

    const report = page.getByLabel("Venue suitability");
    await expect(report.getByText("Suitable", { exact: true })).toBeVisible();
    await expect(report.getByText("Not specified – not checked").first()).toBeVisible();
    await expect(report.getByRole("heading", { name: "Check manually" })).toBeVisible();
    await expect(report.getByText("Stage must face the windows").last()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\01-orchid-hall-suitable.png`, fullPage: true });
  });

  test("AC2, AC3 an unsuitable venue lists every unmet requirement: Lotus Room (109-S2, 109-S3)", async ({ page }) => {
    await signIn(page, /Event Coordinator(?! Lead)/, COORDINATOR, /\/dashboard\/event_coordinator$/);
    await page.goto(`/events/${eventId}/venue-request`);
    await page.getByLabel("Venue", { exact: true }).selectOption(lotusId);
    await page.getByRole("button", { name: "Check suitability" }).click();

    const report = page.getByLabel("Venue suitability");
    await expect(report.getByText("Not suitable")).toBeVisible();
    await expect(report.getByText("Expected attendance 120 exceeds capacity 60")).toBeVisible();
    await expect(report.getByText("Theatre not supported")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\02-lotus-room-not-suitable.png`, fullPage: true });
  });

  test("AC5 a start before opening hours is flagged from the typed time (109-S5)", async ({ page }) => {
    await signIn(page, /Event Coordinator(?! Lead)/, COORDINATOR, /\/dashboard\/event_coordinator$/);
    await page.goto(`/events/${eventId}/venue-request`);
    await page.getByLabel("Venue", { exact: true }).selectOption(orchidId);
    await page.getByLabel("Start time").fill("07:00");
    await page.getByRole("button", { name: "Check suitability" }).click();

    await expect(page.getByLabel("Venue suitability").getByText("Open 08:00–22:00, the event runs 07:00–12:00")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\03-outside-operating-hours.png`, fullPage: true });
  });

  test("AC7 venue staff see the report on the request they review (109-S7)", async ({ page }) => {
    await signIn(page, /Venue Staff/, STAFF, /\/dashboard\/venue_staff$/);
    await page.goto(`/booking-queue/${bookingId}`);

    await expect(page.getByRole("heading", { name: "Suitability" })).toBeVisible();
    await expect(page.getByLabel("Venue suitability").getByText("Not suitable")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\04-venue-staff-queue-detail.png`, fullPage: true });
  });
});
