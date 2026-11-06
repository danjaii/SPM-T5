import { waitForHydration } from "../../fixtures/hydration";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-182: Technical Support Staff maintain the equipment catalogue. They are told what is missing (182-S4), add an item and
// see it with every unit free (182-S1), edit it in place (182-S2) and mark it under maintenance, after which the inventory shows
// no free units and says why (182-S3). A coordinator is kept out of the page (182-S5). Items made here carry this case's ID and a
// random suffix; the seeded items are never changed.
const t = tc("E2E-EQP-04");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const name = data.name("Microphone");
  const renamed = data.name("Microphone Pro");
  for (const n of [name, renamed]) {
    data.trackWhere("activity_log", `action_type=like.equipment_*&description=ilike.*${encodeURIComponent(n)}*`);
    data.trackWhere("equipment", `name=eq.${encodeURIComponent(n)}`);
  }
  const tech = await as("tech");
  const list = tech.getByRole("list", { name: "Equipment catalogue" });
  const add = tech.getByRole("form", { name: "Add equipment" });

  await test.step("182-S4: only a type is given, so the missing fields are named and nothing is created", async () => {
    await tech.goto("/equipment-inventory");
    await tech.getByRole("link", { name: "Manage catalogue" }).click();
    await expect(tech).toHaveURL(/\/equipment-catalogue$/);
    await expect(tech.getByRole("heading", { name: "Equipment catalogue" })).toBeVisible();
    await waitForHydration(tech, "#new-name");
    await add.getByLabel("Type").fill("Audio");
    await add.getByRole("button", { name: "Add equipment" }).click();
    await expect(tech.getByText("Enter the equipment's name.")).toBeVisible();
    await expect(tech.getByText(/Quantity must be a whole number from 1 to 100000/)).toBeVisible();
    await expect(add.getByLabel("Type")).toHaveValue("Audio");
  });

  await test.step("182-S1: a complete item is added to the list and shows in the inventory with every unit free", async () => {
    await add.getByLabel(/^Name/).fill(`  ${name}  `);
    await add.getByLabel(/^Quantity/).fill("5");
    await add.getByLabel("Location").fill("Test store");
    await add.getByRole("button", { name: "Add equipment" }).click();
    await expect(tech.getByRole("status")).toContainText(`Added "${name}"`);
    await expect(list.getByRole("listitem").filter({ hasText: name })).toContainText("Available");

    await tech.goto("/equipment-inventory");
    const row = tech.getByRole("row").filter({ hasText: name });
    await expect(row).toContainText("5 of 5");
    await expect(row).toContainText("All free");
  });

  await test.step("182-S2: it is edited in place, a new name and quantity", async () => {
    await tech.goto("/equipment-catalogue");
    await waitForHydration(tech, "#new-name");
    await tech.getByRole("button", { name: `Edit ${name}` }).click();
    const edit = tech.getByRole("form", { name: `Edit ${name}` });
    await expect(edit.getByLabel(/^Name/)).toHaveValue(name);
    await edit.getByLabel(/^Name/).fill(renamed);
    await edit.getByLabel(/^Quantity/).fill("8");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(tech.getByRole("status")).toContainText(`Saved "${renamed}"`);
    await expect(list.getByRole("listitem").filter({ hasText: renamed })).toContainText("8 in total");
  });

  await test.step("182-S3: under maintenance it has no free units in the inventory, and the inventory says why", async () => {
    await tech.getByRole("button", { name: `Edit ${renamed}` }).click();
    const again = tech.getByRole("form", { name: `Edit ${renamed}` });
    await again.getByLabel("Status").selectOption("under_maintenance");
    await again.getByRole("button", { name: "Save changes" }).click();
    await expect(list.getByRole("listitem").filter({ hasText: renamed })).toContainText("Under maintenance");

    await tech.goto("/equipment-inventory");
    const row = tech.getByRole("row").filter({ hasText: renamed });
    await expect(row).toContainText("0 of 8");
    await expect(row).toContainText("Under maintenance");
  });

  await test.step("182-S5: a coordinator is kept out of the catalogue page", async () => {
    const coordinator = await as("coordinator");
    await coordinator.goto("/equipment-catalogue");
    await expect(coordinator).toHaveURL(/\/access-denied$/);
  });
});
