import { LeadQueuePage } from "../../pages/ReviewPages";
import { waitForHydration } from "../../fixtures/hydration";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-189 and the Week 7 change ("the Lead can view all coordinator assignments and active events"): the Lead's Active events list
// shows every active event that has a coordinator, earliest first, and not an unassigned request or a closed event; it filters by
// coordinator, status and name, tells the Lead when nothing matches, and is for Leads only.
const t = tc("E2E-ASSIGN-05");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const rachels = await data.event({ status: "planning", coordinator: "coordinator", day: "2031-11-14", label: "Rachel's later" });
  const earlier = await data.event({ status: "approved", coordinator: "coordinator", day: "2031-11-13", label: "Rachel's earlier" });
  const priyas = await data.event({ status: "approved", coordinator: "coordinator3", day: "2031-11-16", label: "Priya's" });
  const unassigned = await data.event({ status: "submitted", coordinator: null, label: "Unassigned", submittedAt: new Date(Date.now() - 3600e3).toISOString() });
  const closed = await data.event({ status: "completed", coordinator: "coordinator", day: "2031-11-12", label: "Completed" });
  const ours = [rachels, earlier, priyas];
  const lead = await as("lead");
  const row = (e: { name: string }) => lead.getByRole("row").filter({ hasText: e.name });
  const pick = async (filter: "Coordinator" | "Status", option: string) => {
    await lead.getByRole("combobox", { name: filter }).click();
    await lead.getByRole("option", { name: option, exact: true }).click();
  };

  await test.step("from the unassigned queue, View all active events opens the list, which is also in the sidebar (AC6)", async () => {
    const queue = new LeadQueuePage(lead);
    await queue.open();
    await lead.getByRole("link", { name: "View all active events" }).click();
    await expect(lead).toHaveURL(/\/lead\/events$/);
    await expect(lead.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Active events" })).toHaveAttribute("aria-current", "page");
    await waitForHydration(lead, "input[type=search]");
  });

  await test.step("it lists the active, assigned events, earliest first, and not the unassigned or the completed one (AC1, AC2)", async () => {
    for (const e of ours) await expect(row(e)).toBeVisible();
    await expect(row(rachels)).toContainText("Rachel Tan");
    await expect(row(priyas)).toContainText("Priya Nair");
    await expect(row(unassigned), "an unassigned request stays on the queue").toHaveCount(0);
    await expect(row(closed), "a closed event is not active").toHaveCount(0);
    const rows = await lead.getByRole("row").allInnerTexts();
    const at = (e: { name: string }) => rows.findIndex((text) => text.includes(e.name));
    expect(at(earlier), "13 Nov before 14 Nov").toBeLessThan(at(rachels));
    expect(at(rachels), "14 Nov before 16 Nov").toBeLessThan(at(priyas));
  });

  await test.step("the Coordinator filter keeps that coordinator's events (AC3)", async () => {
    await pick("Coordinator", "Priya Nair");
    await expect(row(priyas)).toBeVisible();
    await expect(row(rachels)).toHaveCount(0);
    await expect(lead.getByText(/^Showing \d+ of \d+ active events$/)).toBeVisible();
  });

  await test.step("the Status filter, combined with the coordinator, narrows further (AC3)", async () => {
    await lead.getByRole("button", { name: "Clear filters" }).first().click();
    await pick("Coordinator", "Rachel Tan");
    await pick("Status", "Planning");
    await expect(row(rachels)).toBeVisible();
    await expect(row(earlier), "approved, not planning").toHaveCount(0);
  });

  await test.step("typing part of a name filters by name, and clearing shows them all again (AC3)", async () => {
    await lead.getByRole("button", { name: "Clear filters" }).first().click();
    await lead.getByPlaceholder("Event name").fill("earlier");
    await expect(row(earlier)).toBeVisible();
    await expect(row(rachels)).toHaveCount(0);
    await lead.getByRole("button", { name: "Clear filters" }).first().click();
    for (const e of ours) await expect(row(e)).toBeVisible();
  });

  await test.step("a name that matches nothing says so, with a way to clear it (AC4)", async () => {
    await lead.getByPlaceholder("Event name").fill("no event is called this");
    await expect(lead.getByText("No events match these filters.")).toBeVisible();
    await lead.getByRole("button", { name: "Clear filters" }).last().click();
    await expect(row(rachels)).toBeVisible();
  });

  await test.step("a coordinator is refused the page (AC5)", async () => {
    const coordinator = await as("coordinator");
    await coordinator.goto("/lead/events");
    await expect(coordinator).toHaveURL(/\/access-denied/);
  });
});
