import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// SCRUM-58: needs the whole local stack (supabase start + seed, auth-service, venue-service) and the service-role key to arrange
// a throwaway venue with a booking at it; CI's e2e job has none of that. Opt in with E2E_FULL_STACK=1 and SUPABASE_URL +
// SUPABASE_SECRET_KEY set. Happy-path screenshots go to C:\dev\SPM-T5-screenshots\SCRUM-58\.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");
test.describe.configure({ mode: "serial" });

const PASSWORD = "ConnectSphere2026!";
const SHOTS = "C:\\dev\\SPM-T5-screenshots\\SCRUM-58";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";

const tag = Math.random().toString(36).slice(2, 7);
const venueName = `IT-58-Orchid-${tag}`;
const renamed = `${venueName} East`;
const EVENT_NAME = `IT-58 Summit ${tag}`;

let venueId = "";
let eventId = "";

const rest = async <T = unknown>(path: string, init: RequestInit = {}): Promise<T> => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", Prefer: "return=representation", ...init.headers },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json().catch(() => null)) as T;
};
const idOf = async (path: string) => ((await rest<{ id: string }[]>(path))[0]).id;

test.beforeAll(async () => {
  test.skip(!SECRET, "set SUPABASE_SECRET_KEY to the local service-role key");
  mkdirSync(SHOTS, { recursive: true });

  // a venue holding 150 people with the Theatre layout and a projector, and an approved booking for 120 people at it
  [{ id: venueId }] = await rest<{ id: string }[]>("venues", {
    method: "POST",
    body: JSON.stringify({ name: venueName, address: "1 Test Road", max_capacity: 150, operating_hours_start: "08:00", operating_hours_end: "22:00" }),
  });
  const theatre = await idOf("room_layouts?name=eq.Theatre&select=id");
  const projector = await idOf("facilities?name=eq.Projector%20%26%20Screen&select=id");
  await rest("venue_supported_layouts", { method: "POST", body: JSON.stringify({ venue_id: venueId, room_layout_id: theatre, max_capacity_for_layout: 150 }) });
  await rest("venue_facilities", { method: "POST", body: JSON.stringify({ venue_id: venueId, facility_id: projector }) });

  const organiser = await idOf("users?select=id&email=eq.jason.chua@techconnect.example.com");
  const coordinator = await idOf("users?select=id&email=eq.rachel.tan@connectsphere.example.com");
  [{ id: eventId }] = await rest<{ id: string }[]>("events", {
    method: "POST",
    body: JSON.stringify({ name: EVENT_NAME, organiser_id: organiser, assigned_coordinator_id: coordinator, status: "approved", is_draft: false, expected_attendance: 120 }),
  });
  await rest("venue_bookings", {
    method: "POST",
    body: JSON.stringify({
      event_id: eventId,
      venue_id: venueId,
      requested_by: coordinator,
      status: "approved",
      event_start_datetime: "2099-03-10T01:00:00Z",
      event_end_datetime: "2099-03-10T09:00:00Z",
      snapshot_event_name: EVENT_NAME,
      snapshot_expected_attendance: 120,
    }),
  });
});

test.afterAll(async () => {
  if (eventId) {
    await rest(`venue_bookings?event_id=eq.${eventId}`, { method: "DELETE" });
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

// A value filled in before React hydrates the form is thrown away, so wait for the form to be live.
async function waitForVenueForm(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector("#name");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  });
}

test.describe("SCRUM-58 edit an existing venue", () => {
  test("AC1/AC2/AC4: staff edit a venue, cannot clear a required field, and confirm a capacity cut", async ({ page }) => {
    await signIn(page, "Venue Staff", "kenneth.wong@connectsphere.example.com", /\/dashboard\/venue_staff$/);
    await page.goto(`/venues/${venueId}`);
    await expect(page.getByRole("button", { name: "Edit times" })).toBeVisible();
    await page.getByRole("link", { name: "Edit venue" }).click();
    await expect(page).toHaveURL(new RegExp(`/venues/${venueId}/edit$`));
    await waitForVenueForm(page);

    // 58-S1: the form is filled in with the venue as it is
    await expect(page.getByLabel(/^Name/)).toHaveValue(venueName);
    await expect(page.getByLabel("Capacity (required)")).toHaveValue("150");
    await expect(page.getByRole("checkbox", { name: "Theatre" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Projector & Screen" })).toBeChecked();
    await page.screenshot({ path: `${SHOTS}\\01-form-filled-in.png`, fullPage: true });

    // 58-S2: a required field cannot be cleared, and the saved venue is not changed
    await page.getByLabel(/^Name/).fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Enter the venue's name.")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/venues/${venueId}/edit$`));
    await page.screenshot({ path: `${SHOTS}\\02-name-cleared.png`, fullPage: true });

    // 58-S1: a new name and description are saved, and show on the venue's page and in the catalogue
    await page.getByLabel(/^Name/).fill(renamed);
    await page.getByLabel("Description").fill("Now with a stage.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(new RegExp(`/venues/${venueId}$`));
    await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
    await expect(page.getByText("Now with a stage.")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\03-saved-new-name.png`, fullPage: true });
    await page.goto("/venues");
    await expect(page.getByRole("link", { name: renamed })).toBeVisible();

    // 58-S4: cutting the capacity below the booking's 120 people lists it first, and saves nothing yet
    await page.goto(`/venues/${venueId}/edit`);
    await waitForVenueForm(page);
    await page.getByLabel("Capacity (required)").fill("100");
    await page.getByLabel("Capacity for Theatre").fill("100");
    await page.getByRole("button", { name: "Save changes" }).click();
    const panel = page.getByRole("alert").filter({ hasText: "expect more people than the venue would hold" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(EVENT_NAME)).toBeVisible();
    await expect(panel).toContainText("120 people");
    await expect(panel).toContainText("Approved");
    await expect(page).toHaveURL(new RegExp(`/venues/${venueId}/edit$`));
    await page.screenshot({ path: `${SHOTS}\\04-capacity-cut-asks.png`, fullPage: true });

    // Keep editing saves nothing; Save anyway then saves the cut
    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect(panel).toHaveCount(0);
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByRole("button", { name: "Save anyway" }).click();
    await expect(page).toHaveURL(new RegExp(`/venues/${venueId}$`));
    await expect(page.getByText("100 people").first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\05-capacity-cut-saved.png`, fullPage: true });
  });

  test("AC3: a coordinator is not offered the edit and is told why on the page", async ({ page }) => {
    await signIn(page, "Event Coordinator", "rachel.tan@connectsphere.example.com", /\/dashboard\/event_coordinator$/);
    await page.goto(`/venues/${venueId}`);
    await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit venue" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit times" })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}\\06-coordinator-no-edit.png`, fullPage: true });

    await page.goto(`/venues/${venueId}/edit`);
    await expect(page.getByRole("alert")).toHaveText("Only venue staff can edit a venue.");
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}\\07-coordinator-told-why.png`, fullPage: true });
  });
});
