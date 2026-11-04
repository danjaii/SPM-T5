import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// SCRUM-40: needs the whole local stack (supabase start + seed, auth-service, venue-service, and event-service for the dashboards)
// and the service-role key to arrange and clean up the throwaway venues, event and requests; CI's e2e job has none of that. Opt in
// with E2E_FULL_STACK=1 and SUPABASE_URL + SUPABASE_SECRET_KEY set. Happy-path screenshots go to
// C:\dev\SPM-T5-screenshots\SCRUM-40\.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const PASSWORD = "ConnectSphere2026!";
const SHOTS = "C:\\dev\\SPM-T5-screenshots\\SCRUM-40";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
const REASON = "The hall is closed for repainting that day";

test.describe.configure({ mode: "serial" });

const tag = Math.random().toString(36).slice(2, 7);
const orchidName = `IT-40-Orchid-${tag}`;
const lotusName = `IT-40-Lotus-${tag}`;
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

async function signIn(page: Page, role: string, email: string, dashboard: RegExp) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("combobox", { name: "Continue as" }).click();
  await page.getByRole("option", { name: role, exact: true }).click();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(dashboard);
}

// A value filled in before React hydrates the page is thrown away, so wait for the decision buttons to be live.
async function waitForLive(page: Page, name: string) {
  await expect(page.getByRole("button", { name })).toBeVisible();
  await page.waitForFunction((label) => {
    const el = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  }, name);
}

const created = { events: [] as string[], venues: [] as string[], bookings: [] as string[] };
let withSuggestion = "";
let withoutSuggestion = "";

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const [coordinator] = await rest("GET", "users?select=id&email=eq.rachel.tan@connectsphere.example.com");
  const [organiser] = await rest("GET", "users?select=id&role=eq.event_organiser&limit=1");
  const [orchid] = await rest("POST", "venues", { name: orchidName, address: "1 Test Road", max_capacity: 200 });
  const [lotus] = await rest("POST", "venues", { name: lotusName, address: "2 Test Road", max_capacity: 120 });
  created.venues.push(orchid.id as string, lotus.id as string);

  const booking = async (eventName: string, date: string) => {
    const [event] = await rest("POST", "events", {
      name: `${eventName}-${tag}`,
      organiser_id: organiser.id,
      assigned_coordinator_id: coordinator.id,
      status: "approved",
      is_draft: false,
      expected_attendance: 60,
      preferred_start_datetime: sgt(date, "09:00"),
      preferred_end_datetime: sgt(date, "17:00"),
    });
    created.events.push(event.id as string);
    const [row] = await rest("POST", "venue_bookings", {
      event_id: event.id,
      venue_id: orchid.id,
      requested_by: coordinator.id,
      status: "requested",
      event_start_datetime: sgt(date, "09:00"),
      event_end_datetime: sgt(date, "17:00"),
      snapshot_event_name: `${eventName}-${tag}`,
      snapshot_expected_attendance: 60,
    });
    created.bookings.push(row.id as string);
    return { bookingId: row.id as string, eventId: event.id as string };
  };
  // Two requests for the same venue, for different events (an event holds one active request at a time) and on different days
  // (so they do not overlap each other).
  withSuggestion = (await booking("IT-40-Summit", "2031-11-14")).bookingId;
  withoutSuggestion = (await booking("IT-40-Workshop", "2031-12-02")).bookingId;
});

test.afterAll(async () => {
  for (const id of created.bookings) await rest("DELETE", `venue_bookings?id=eq.${id}`).catch(() => []);
  for (const id of created.events) await rest("DELETE", `events?id=eq.${id}`).catch(() => []);
  for (const id of created.venues) await rest("DELETE", `venues?id=eq.${id}`).catch(() => []);
});

test.describe("SCRUM-40 suggest an alternative arrangement", () => {
  test("AC1: Venue Staff reject a request with a suggested alternative, and it is stored with the rejection", async ({ page }) => {
    await signIn(page, "Venue Staff", "kenneth.wong@connectsphere.example.com", /\/dashboard\/venue_staff$/);
    await page.goto(`/booking-queue/${withSuggestion}`);
    await waitForLive(page, "Reject request");
    await page.screenshot({ path: `${SHOTS}\\01-pending-request.png`, fullPage: true });

    await page.getByRole("button", { name: "Reject request" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Reason for rejection").fill(REASON);
    await expect(dialog.getByLabel("Suggested venue")).toHaveCount(0); // closed until asked for
    await dialog.getByRole("checkbox", { name: "Suggest an alternative" }).check();

    // 40-S4: a venue with no date or times is told what is missing, and nothing is sent
    await dialog.getByLabel("Suggested venue").selectOption({ label: lotusName });
    await dialog.getByRole("button", { name: "Reject request" }).click();
    await expect(dialog.getByText("Enter a date.")).toBeVisible();
    await expect(dialog.getByText("Enter a start time.")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\02-suggestion-incomplete.png`, fullPage: true });

    // 40-S1: the complete suggestion goes with the rejection
    await dialog.getByLabel("Suggested date").fill("2031-11-15");
    await dialog.getByLabel("Suggested start time").fill("09:00");
    await dialog.getByLabel("Suggested end time").fill("17:00");
    await page.screenshot({ path: `${SHOTS}\\03-suggestion-filled-in.png`, fullPage: true });
    await dialog.getByRole("button", { name: "Reject request" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0); // saved: the dialog closes and the page refreshes
    await expect(page.getByRole("button", { name: "Reject request" })).toHaveCount(0); // decided: the Decision section is gone
    await expect
      .poll(async () => (await rest("GET", `venue_bookings?select=status,review_notes,suggested_venue_id&id=eq.${withSuggestion}`))[0])
      .toMatchObject({ status: "rejected", review_notes: REASON, suggested_venue_id: created.venues[1] });
    await page.screenshot({ path: `${SHOTS}\\04-rejected-with-suggestion.png`, fullPage: true });
  });

  test("AC1: the requesting coordinator sees the suggested venue, date and time and can accept it", async ({ page }) => {
    await signIn(page, "Event Coordinator", "rachel.tan@connectsphere.example.com", /\/dashboard\/event_coordinator$/);

    await page.goto(`/venue-bookings/${withSuggestion}`);

    await expect(page.getByRole("heading", { name: "Suggested alternative" })).toBeVisible();
    await expect(page.getByText(new RegExp(`${lotusName} on 2031-11-15`))).toBeVisible();
    await expect(page.getByText(/09:00.17:00/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept suggested alternative" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\05-coordinator-sees-suggestion.png`, fullPage: true });
  });

  test("AC2: the suggestion is optional: a rejection with only a reason works, and the coordinator sees no suggestion", async ({ page }) => {
    await signIn(page, "Venue Staff", "kenneth.wong@connectsphere.example.com", /\/dashboard\/venue_staff$/);
    await page.goto(`/booking-queue/${withoutSuggestion}`);
    await waitForLive(page, "Reject request");

    await page.getByRole("button", { name: "Reject request" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Reason for rejection").fill(REASON);
    await dialog.getByRole("button", { name: "Reject request" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject request" })).toHaveCount(0);

    await expect
      .poll(async () => (await rest("GET", `venue_bookings?select=status,suggested_venue_id&id=eq.${withoutSuggestion}`))[0])
      .toMatchObject({ status: "rejected", suggested_venue_id: null });
    await page.screenshot({ path: `${SHOTS}\\06-rejected-without-suggestion.png`, fullPage: true });
  });
});
