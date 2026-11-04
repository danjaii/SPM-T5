import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// SCRUM-181: needs the whole local stack (supabase start + seed, auth-service, venue-service) and the service-role
// key to arrange and clean up the throwaway layout types and venue; CI's e2e job has none of that. Opt in with
// E2E_FULL_STACK=1 and SUPABASE_URL + SUPABASE_SECRET_KEY set. Happy-path screenshots go to
// C:\dev\SPM-T5-screenshots\SCRUM-181\. The seeded layouts (Theatre and the others) are never renamed or deleted.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const PASSWORD = "ConnectSphere2026!";
const SHOTS = "C:\\dev\\SPM-T5-screenshots\\SCRUM-181";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";

test.describe.configure({ mode: "serial" });

const tag = Math.random().toString(36).slice(2, 7);
const typeA = `IT-181-E2E-Cabaret-${tag}`;
const typeARenamed = `IT-181-E2E-Gala-${tag}`;
const typeB = `IT-181-E2E-Boardroom-${tag}`;
const venueName = `IT-181-E2E-Venue-${tag}`;

const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", Prefer: "return=representation", ...init.headers },
  });

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

// Everything these tests make carries the IT-181-E2E- prefix and this run's tag, so cleanup finds it by name.
test.afterAll(async () => {
  const venues = (await (await rest(`venues?name=like.IT-181-E2E-%25${tag}&select=id`)).json()) as { id: string }[];
  for (const { id } of venues) {
    await rest(`activity_log?entity_id=eq.${id}`, { method: "DELETE" });
    await rest(`venues?id=eq.${id}`, { method: "DELETE" }); // its layout links go with it
  }
  const layouts = (await (await rest(`room_layouts?name=like.IT-181-E2E-%25${tag}&select=id`)).json()) as { id: string }[];
  for (const { id } of layouts) await rest(`room_layouts?id=eq.${id}`, { method: "DELETE" });
  // The audit row of a deleted layout type stays by design, so find these by what they say: every one names this run's tag.
  await rest(`activity_log?action_type=like.layout_type_*&description=ilike.*IT-181-E2E-*${tag}*`, { method: "DELETE" });
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
async function waitForLive(page: Page, selector: string) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  }, selector);
}

const signInStaff = (page: Page) => signIn(page, "Venue Staff", "kenneth.wong@connectsphere.example.com", /\/dashboard\/venue_staff$/);

test.describe("SCRUM-181 maintain room layout types", () => {
  test("AC5/AC1/AC2/AC3: staff are told about a bad name, add a type, see it in the venue form, rename it and delete it", async ({ page }) => {
    await signInStaff(page);
    await page.goto("/venues");
    await page.getByRole("link", { name: "Layout types" }).click();
    await expect(page).toHaveURL(/\/venues\/layout-types$/);
    await expect(page.getByRole("heading", { name: "Layout types" })).toBeVisible();
    await waitForLive(page, "#new-layout-name");

    // 181-S5: an empty name and a name that is already there (ignoring case) are refused on the field, and what was typed stays
    await page.getByRole("button", { name: "Add layout type" }).click();
    await expect(page.getByText("Enter a name for the layout type.")).toBeVisible();
    await page.getByLabel("New layout type").fill("theatre");
    await page.getByRole("button", { name: "Add layout type" }).click();
    await expect(page.getByText("A layout type with that name already exists.")).toBeVisible();
    await expect(page.getByLabel("New layout type")).toHaveValue("theatre");
    await page.screenshot({ path: `${SHOTS}\\01-bad-names.png`, fullPage: true });

    // 181-S1: a new type is added to the list
    await page.getByLabel("New layout type").fill(`  ${typeA}  `);
    await page.getByRole("button", { name: "Add layout type" }).click();
    await expect(page.getByRole("status")).toContainText(`Added "${typeA}"`);
    await expect(page.getByRole("list", { name: "Layout types" })).toContainText(typeA);
    await page.screenshot({ path: `${SHOTS}\\02-type-added.png`, fullPage: true });

    // 181-S1: and it is offered straight away when adding a venue
    await page.goto("/venues/new");
    await waitForLive(page, "#name");
    await expect(page.getByRole("checkbox", { name: typeA })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\03-in-the-venue-form.png`, fullPage: true });

    // 181-S2: rename it in place
    await page.goto("/venues/layout-types");
    await waitForLive(page, "#new-layout-name");
    await page.getByRole("button", { name: `Rename ${typeA}` }).click();
    await page.getByLabel(`New name for ${typeA}`).fill(typeARenamed);
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByRole("status")).toContainText(`Renamed to "${typeARenamed}"`);
    await expect(page.getByRole("list", { name: "Layout types" })).not.toContainText(typeA);
    await page.screenshot({ path: `${SHOTS}\\04-type-renamed.png`, fullPage: true });

    // 181-S3: delete it after a confirmation; going back first deletes nothing
    await page.getByRole("button", { name: `Delete ${typeARenamed}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(typeARenamed);
    await page.screenshot({ path: `${SHOTS}\\05-confirm-delete.png`, fullPage: true });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("list", { name: "Layout types" })).toContainText(typeARenamed);
    await page.getByRole("button", { name: `Delete ${typeARenamed}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete layout type" }).click();
    await expect(page.getByRole("status")).toContainText(`Deleted "${typeARenamed}"`);
    await expect(page.getByRole("list", { name: "Layout types" })).not.toContainText(typeARenamed);
    await page.screenshot({ path: `${SHOTS}\\06-type-deleted.png`, fullPage: true });
  });

  test("AC4: a type a venue uses cannot be deleted, and the venue is named", async ({ page }) => {
    // arranged with the service-role key: a type, and a throwaway venue that supports it
    const layout = ((await (await rest("room_layouts", { method: "POST", body: JSON.stringify({ name: typeB }) })).json()) as { id: string }[])[0];
    const venue = ((await (await rest("venues", { method: "POST", body: JSON.stringify({ name: venueName, address: "1 Test Road", max_capacity: 60 }) })).json()) as { id: string }[])[0];
    await rest("venue_supported_layouts", { method: "POST", body: JSON.stringify({ venue_id: venue.id, room_layout_id: layout.id, max_capacity_for_layout: 40 }) });

    await signInStaff(page);
    await page.goto("/venues/layout-types");
    await waitForLive(page, "#new-layout-name");
    await expect(page.getByRole("list", { name: "Layout types" })).toContainText(typeB);

    await page.getByRole("button", { name: `Delete ${typeB}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete layout type" }).click();

    // Next.js keeps its own empty role="alert" route announcer on every page, so pick ours by its text.
    const refusal = page.getByRole("alert").filter({ hasText: "cannot be deleted" });
    await expect(refusal).toContainText(`"${typeB}" cannot be deleted because 1 venue uses it: ${venueName}.`);
    await expect(refusal.getByRole("link", { name: venueName })).toHaveAttribute("href", `/venues/${venue.id}`);
    await expect(page.getByRole("list", { name: "Layout types" })).toContainText(typeB);
    await page.screenshot({ path: `${SHOTS}\\07-in-use-refused.png`, fullPage: true });
  });

  test("AC6: a coordinator is not offered the page and is told why when they open its address", async ({ page }) => {
    await signIn(page, "Event Coordinator", "rachel.tan@connectsphere.example.com", /\/dashboard\/event_coordinator$/);
    await page.goto("/venues");
    await expect(page.getByRole("link", { name: "Layout types" })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}\\08-coordinator-no-button.png`, fullPage: true });

    await page.goto("/venues/layout-types");
    await expect(page.getByRole("alert").filter({ hasText: "Only venue staff" })).toHaveText("Only venue staff can manage layout types.");
    await expect(page.getByRole("button", { name: "Add layout type" })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}\\09-coordinator-told-why.png`, fullPage: true });
  });
});
