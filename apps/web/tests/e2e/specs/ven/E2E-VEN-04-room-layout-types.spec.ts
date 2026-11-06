import { waitForHydration } from "../../fixtures/hydration";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-181: Venue Staff maintain the room layout types. A bad name is refused on the field (181-S5); a new type is added and
// offered when adding a venue (181-S1), renamed in place (181-S2) and deleted after a confirmation (181-S3); a type a venue uses
// cannot be deleted and the venue is named (181-S4); a coordinator is kept out of the page and told why (181-S6). The seeded
// layout types are never renamed or deleted: every name here carries this case's ID and a random suffix.
const t = tc("E2E-VEN-04");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const added = data.name("Cabaret");
  const renamed = data.name("Gala");
  const inUse = data.name("Boardroom");
  // The UI deletes the first two itself; these catch them if the test stops half way. The audit row of a deleted layout type
  // stays by design, so those rows are removed by what they say.
  for (const name of [added, renamed, inUse]) {
    data.trackWhere("activity_log", `action_type=like.layout_type_*&description=ilike.*${encodeURIComponent(name)}*`);
    data.trackWhere("room_layouts", `name=eq.${encodeURIComponent(name)}`);
  }
  const staff = await as("venueStaff");
  const typeList = staff.getByRole("list", { name: "Layout types" });

  await test.step("181-S5: an empty name and a name already there (ignoring case) are refused on the field", async () => {
    await staff.goto("/venues");
    await staff.getByRole("link", { name: "Layout types" }).click();
    await expect(staff).toHaveURL(/\/venues\/layout-types$/);
    await expect(staff.getByRole("heading", { name: "Layout types" })).toBeVisible();
    await waitForHydration(staff, "#new-layout-name");
    await staff.getByRole("button", { name: "Add layout type" }).click();
    await expect(staff.getByText("Enter a name for the layout type.")).toBeVisible();
    await staff.getByLabel("New layout type").fill("theatre");
    await staff.getByRole("button", { name: "Add layout type" }).click();
    await expect(staff.getByText("A layout type with that name already exists.")).toBeVisible();
    await expect(staff.getByLabel("New layout type")).toHaveValue("theatre");
  });

  await test.step("181-S1: a new type is added to the list and is offered when adding a venue", async () => {
    await staff.getByLabel("New layout type").fill(`  ${added}  `);
    await staff.getByRole("button", { name: "Add layout type" }).click();
    await expect(staff.getByRole("status")).toContainText(`Added "${added}"`);
    await expect(typeList).toContainText(added);
    await staff.goto("/venues/new");
    await waitForHydration(staff, "#name");
    await expect(staff.getByRole("checkbox", { name: added })).toBeVisible();
  });

  await test.step("181-S2: it is renamed in place", async () => {
    await staff.goto("/venues/layout-types");
    await waitForHydration(staff, "#new-layout-name");
    await staff.getByRole("button", { name: `Rename ${added}` }).click();
    await staff.getByLabel(`New name for ${added}`).fill(renamed);
    await staff.getByRole("button", { name: "Save name" }).click();
    await expect(staff.getByRole("status")).toContainText(`Renamed to "${renamed}"`);
    await expect(typeList).not.toContainText(added);
  });

  await test.step("181-S3: it is deleted after a confirmation, and going back first deletes nothing", async () => {
    await staff.getByRole("button", { name: `Delete ${renamed}` }).click();
    const dialog = staff.getByRole("dialog");
    await expect(dialog).toContainText(renamed);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(typeList).toContainText(renamed);
    await staff.getByRole("button", { name: `Delete ${renamed}` }).click();
    await staff.getByRole("dialog").getByRole("button", { name: "Delete layout type" }).click();
    await expect(staff.getByRole("status")).toContainText(`Deleted "${renamed}"`);
    await expect(typeList).not.toContainText(renamed);
    expect(await data.rest<unknown[]>(`room_layouts?select=id&name=eq.${encodeURIComponent(renamed)}`), "gone from the database").toEqual([]);
  });

  await test.step("181-S4: a type a venue uses cannot be deleted, and the venue is named", async () => {
    const layout = await data.insert<{ id: string }>("room_layouts", { name: inUse });
    const venue = await data.venue({ capacity: 60, label: "Uses the layout" });
    await data.insert("venue_supported_layouts", { venue_id: venue.id, room_layout_id: layout.id, max_capacity_for_layout: 40 });

    await staff.goto("/venues/layout-types");
    await waitForHydration(staff, "#new-layout-name");
    await expect(typeList).toContainText(inUse);
    await staff.getByRole("button", { name: `Delete ${inUse}` }).click();
    await staff.getByRole("dialog").getByRole("button", { name: "Delete layout type" }).click();
    // Next.js keeps its own empty role="alert" route announcer on every page, so pick ours by its text
    const refusal = staff.getByRole("alert").filter({ hasText: "cannot be deleted" });
    await expect(refusal).toContainText(`"${inUse}" cannot be deleted because 1 venue uses it: ${venue.name}.`);
    await expect(refusal.getByRole("link", { name: venue.name })).toHaveAttribute("href", `/venues/${venue.id}`);
    await expect(typeList).toContainText(inUse);
  });

  await test.step("181-S6: a coordinator is not offered the page and is told why when opening its address", async () => {
    const coordinator = await as("coordinator");
    await coordinator.goto("/venues");
    await expect(coordinator.getByRole("link", { name: "Layout types" })).toHaveCount(0);
    await coordinator.goto("/venues/layout-types");
    await expect(coordinator.getByRole("alert").filter({ hasText: "Only venue staff" })).toHaveText("Only venue staff can manage layout types.");
    await expect(coordinator.getByRole("button", { name: "Add layout type" })).toHaveCount(0);
  });
});
