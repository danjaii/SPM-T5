import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// SCRUM-182: needs the whole local stack (supabase start + seed, auth-service, equipment-service) and the service-role key to
// clean up the throwaway items; CI's e2e job has none of that. Opt in with E2E_FULL_STACK=1 and SUPABASE_URL + SUPABASE_SECRET_KEY
// set. Happy-path screenshots go to C:\dev\SPM-T5-screenshots\SCRUM-182\. The seeded items are never changed.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const PASSWORD = "ConnectSphere2026!";
const SHOTS = "C:\\dev\\SPM-T5-screenshots\\SCRUM-182";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";

test.describe.configure({ mode: "serial" });

const tag = Math.random().toString(36).slice(2, 7);
const itemName = `IT-182-E2E-Microphone-${tag}`;
const renamed = `IT-182-E2E-Microphone-Pro-${tag}`;

const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", Prefer: "return=representation", ...init.headers },
  });

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

// Everything these tests make carries the IT-182-E2E- prefix and this run's tag, so cleanup finds it by name.
test.afterAll(async () => {
  const items = (await (await rest(`equipment?name=like.IT-182-E2E-%25${tag}&select=id`)).json()) as { id: string }[];
  for (const { id } of items) await rest(`equipment?id=eq.${id}`, { method: "DELETE" });
  await rest(`activity_log?action_type=like.equipment_*&description=ilike.*IT-182-E2E-*${tag}*`, { method: "DELETE" });
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

test.describe("SCRUM-182 maintain the equipment catalogue", () => {
  test("AC4/AC1/AC2/AC3: staff are told what is missing, add an item, see it free, edit it and mark it under maintenance", async ({ page }) => {
    await signIn(page, "Technical Support Staff", "aaron.koh@connectsphere.example.com", /\/dashboard\/technical_support_staff$/);
    await page.goto("/equipment-inventory");
    await page.getByRole("link", { name: "Manage catalogue" }).click();
    await expect(page).toHaveURL(/\/equipment-catalogue$/);
    await expect(page.getByRole("heading", { name: "Equipment catalogue" })).toBeVisible();
    await waitForLive(page, "#new-name");

    // 182-S4: only a type is given; the required fields are named and nothing is created
    const add = page.getByRole("form", { name: "Add equipment" });
    await add.getByLabel("Type").fill("Audio");
    await add.getByRole("button", { name: "Add equipment" }).click();
    await expect(page.getByText("Enter the equipment's name.")).toBeVisible();
    await expect(page.getByText(/Quantity must be a whole number from 1 to 100000/)).toBeVisible();
    await expect(add.getByLabel("Type")).toHaveValue("Audio");
    await page.screenshot({ path: `${SHOTS}\\01-missing-fields.png`, fullPage: true });

    // 182-S1: a complete item is added to the list
    await add.getByLabel(/^Name/).fill(`  ${itemName}  `);
    await add.getByLabel(/^Quantity/).fill("5");
    await add.getByLabel("Location").fill("Test store");
    await page.screenshot({ path: `${SHOTS}\\02-filled-in.png`, fullPage: true });
    await add.getByRole("button", { name: "Add equipment" }).click();
    await expect(page.getByRole("status")).toContainText(`Added "${itemName}"`);
    const list = page.getByRole("list", { name: "Equipment catalogue" });
    await expect(list).toContainText(itemName);
    await expect(list.getByRole("listitem").filter({ hasText: itemName })).toContainText("Available");
    await page.screenshot({ path: `${SHOTS}\\03-item-added.png`, fullPage: true });

    // 182-S1: and it is in the inventory with every unit free
    await page.goto("/equipment-inventory");
    const inventoryRow = page.getByRole("row").filter({ hasText: itemName });
    await expect(inventoryRow).toContainText("5 of 5");
    await expect(inventoryRow).toContainText("All free");
    await page.screenshot({ path: `${SHOTS}\\04-in-the-inventory.png`, fullPage: true });

    // 182-S2: edit it in place: a new name and quantity
    await page.goto("/equipment-catalogue");
    await waitForLive(page, "#new-name");
    await page.getByRole("button", { name: `Edit ${itemName}` }).click();
    const edit = page.getByRole("form", { name: `Edit ${itemName}` });
    await expect(edit.getByLabel(/^Name/)).toHaveValue(itemName);
    await edit.getByLabel(/^Name/).fill(renamed);
    await edit.getByLabel(/^Quantity/).fill("8");
    await page.screenshot({ path: `${SHOTS}\\05-editing.png`, fullPage: true });
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toContainText(`Saved "${renamed}"`);
    await expect(list.getByRole("listitem").filter({ hasText: renamed })).toContainText("8 in total");

    // 182-S3: mark it under maintenance: the inventory then shows no free units and says why
    await page.getByRole("button", { name: `Edit ${renamed}` }).click();
    const again = page.getByRole("form", { name: `Edit ${renamed}` });
    await again.getByLabel("Status").selectOption("under_maintenance");
    await again.getByRole("button", { name: "Save changes" }).click();
    await expect(list.getByRole("listitem").filter({ hasText: renamed })).toContainText("Under maintenance");
    await page.screenshot({ path: `${SHOTS}\\06-under-maintenance.png`, fullPage: true });

    await page.goto("/equipment-inventory");
    const after = page.getByRole("row").filter({ hasText: renamed });
    await expect(after).toContainText("0 of 8");
    await expect(after).toContainText("Under maintenance");
    await page.screenshot({ path: `${SHOTS}\\07-inventory-no-free-units.png`, fullPage: true });
  });

  test("AC5: a coordinator is not offered the page and is kept out of it", async ({ page }) => {
    await signIn(page, "Event Coordinator", "rachel.tan@connectsphere.example.com", /\/dashboard\/event_coordinator$/);

    await page.goto("/equipment-catalogue");

    await expect(page).toHaveURL(/\/access-denied$/);
    await page.screenshot({ path: `${SHOTS}\\08-coordinator-kept-out.png`, fullPage: true });
  });
});
