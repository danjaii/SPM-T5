import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// SCRUM-46: needs the whole local stack (supabase start + seed, auth-service, event-service, notification-service),
// which CI's e2e job doesn't run. Opt in with E2E_FULL_STACK=1, and set SUPABASE_SECRET_KEY (the local service-role key)
// so this spec can arrange its own rows: nothing is added to supabase/seed.sql.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");
test.describe.configure({ mode: "serial" });

const PASSWORD = "ConnectSphere2026!";
const COORDINATOR_EMAIL = "rachel.tan@connectsphere.example.com";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const SHOTS = "C:\\dev\\SPM-T5-screenshots\\SCRUM-46";
const OWN_TITLE = "E2E-46 Your event was updated";
const RESTRICTED_TITLE = "E2E-46 A booking you no longer manage";
const NO_ACCESS = "You no longer have access to this item";

/** The service-role REST API: bypasses RLS, so it can arrange rows a signed-in user could never write. */
async function rest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SECRET_KEY,
      Authorization: `Bearer ${SECRET_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json().catch(() => null)) as T;
}

let ownEventId: string;
let restrictedKind: "venue_booking" | "event";

test.beforeAll(async () => {
  test.skip(!SECRET_KEY, "set SUPABASE_SECRET_KEY to the local service-role key");
  mkdirSync(SHOTS, { recursive: true });

  const [rachel] = await rest<{ id: string }[]>(`users?email=eq.${COORDINATOR_EMAIL}&select=id`);
  const [own] = await rest<{ id: string }[]>(
    `events?assigned_coordinator_id=eq.${rachel.id}&status=neq.draft&select=id&limit=1`,
  );
  ownEventId = own.id;

  // A target Rachel cannot see: another coordinator's venue booking, else another coordinator's draft event.
  const bookings = await rest<{ id: string }[]>(
    `venue_bookings?select=id,events!inner(assigned_coordinator_id)&events.assigned_coordinator_id=neq.${rachel.id}&limit=1`,
  );
  let restricted: Record<string, string>;
  if (bookings.length) {
    restrictedKind = "venue_booking";
    restricted = { venue_booking_id: bookings[0].id };
  } else {
    const drafts = await rest<{ id: string }[]>(
      `events?status=eq.draft&assigned_coordinator_id=neq.${rachel.id}&select=id&limit=1`,
    );
    test.skip(!drafts.length, "needs another coordinator's venue booking or draft event in the seed");
    restrictedKind = "event";
    restricted = { event_id: drafts[0].id };
  }

  await rest("notifications?title=like.E2E-46*", { method: "DELETE" });
  await rest("notifications", {
    method: "POST",
    body: JSON.stringify([
      { user_id: rachel.id, type: "event_submitted", title: OWN_TITLE, message: "E2E own event row.", event_id: ownEventId, created_at: new Date(Date.now() - 60_000).toISOString() },
      { user_id: rachel.id, type: "venue_booking_flagged", title: RESTRICTED_TITLE, message: "E2E restricted row.", ...restricted },
    ]),
  });
});

test.afterAll(async () => {
  if (SECRET_KEY) await rest("notifications?title=like.E2E-46*", { method: "DELETE" });
});

// A value filled in before React hydrates the form is thrown away by hydration, so wait for the form to be live.
async function waitForLoginForm(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector("input[type=password]");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  });
}

// Same for the list: a click before hydration does nothing, so wait for the row buttons to be live.
async function openNotifications(page: Page) {
  await page.goto("/notifications");
  await page.waitForFunction(() => {
    const el = document.querySelector("li.notification button");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  });
}

async function signInAsCoordinator(page: Page) {
  await page.goto("/login");
  await waitForLoginForm(page);
  await page.locator("label.role-option", { hasText: /Event Coordinator(?! Lead)/ }).click();
  await page.getByLabel("Work email").fill(COORDINATOR_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard\/event_coordinator$/);
}

test.describe("SCRUM-46 view and manage notifications", () => {
  test("46-S1 + 46-S3: the dashboard shows the unread count and the list marks unread rows", async ({ page }) => {
    await signInAsCoordinator(page);

    const link = page.getByRole("link", { name: /^Notifications \(\d+ unread\)$/ });
    await expect(link).toBeVisible();
    expect(Number((await link.textContent())!.match(/\((\d+) unread\)/)![1])).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: `${SHOTS}\\01-dashboard-unread-count.png`, fullPage: true });

    await link.click();
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();

    const own = page.locator("li.notification", { hasText: OWN_TITLE });
    const restricted = page.locator("li.notification", { hasText: RESTRICTED_TITLE });
    await expect(own).toHaveClass(/notification--unread/);
    await expect(own).toContainText("Unread");
    await expect(restricted).toContainText("Unread");
    await expect(page.locator("li.notification:not(.notification--unread)").first()).not.toContainText("Unread");
    await page.screenshot({ path: `${SHOTS}\\02-notification-list.png`, fullPage: true });
  });

  test("46-S7: a notification for something I can no longer open shows no access and goes nowhere", async ({ page }) => {
    await signInAsCoordinator(page);
    await page.goto("/notifications");
    const restricted = page.locator("li.notification", { hasText: RESTRICTED_TITLE });
    await expect(restricted).toContainText(NO_ACCESS);
    expect(restrictedKind).toBeTruthy();

    await restricted.getByText(RESTRICTED_TITLE).click();

    await expect(restricted).not.toHaveClass(/notification--unread/);
    await expect(page).toHaveURL(/\/notifications$/);
    await page.screenshot({ path: `${SHOTS}\\03-no-access-notification.png`, fullPage: true });
  });

  test("46-S4 + 46-S5: opening a notification marks it read and takes me to the event", async ({ page }) => {
    await signInAsCoordinator(page);
    await page.goto("/notifications");
    const own = page.locator("li.notification", { hasText: OWN_TITLE });
    await expect(own).toHaveClass(/notification--unread/);

    await own.getByText(OWN_TITLE).click();

    await expect(page).toHaveURL(new RegExp(`/events/${ownEventId}$`));
    await page.screenshot({ path: `${SHOTS}\\04-opened-event.png`, fullPage: true });

    await page.goto("/notifications");
    await expect(page.locator("li.notification", { hasText: OWN_TITLE })).not.toHaveClass(/notification--unread/);
    await expect(page.locator("li.notification", { hasText: OWN_TITLE })).not.toContainText("Unread");
    await page.screenshot({ path: `${SHOTS}\\05-all-read.png`, fullPage: true });
  });

  test("46-S6: the list shows only my rows (none of another user's E2E rows)", async ({ page }) => {
    const [organiser] = await rest<{ id: string }[]>(`users?email=eq.jason.chua@techconnect.example.com&select=id`);
    await rest("notifications", {
      method: "POST",
      body: JSON.stringify([{ user_id: organiser.id, type: "event_submitted", title: "E2E-46 Organiser only", message: "Not for Rachel." }]),
    });
    await signInAsCoordinator(page);
    await page.goto("/notifications");
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await expect(page.getByText("E2E-46 Organiser only")).toHaveCount(0);
  });
});
