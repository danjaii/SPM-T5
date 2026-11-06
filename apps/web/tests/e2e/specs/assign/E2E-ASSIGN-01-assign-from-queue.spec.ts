import { LeadQueuePage } from "../../pages/ReviewPages";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-77 (the unassigned queue) and SCRUM-78 (assign), Week 7 change 5: submitted requests with no coordinator are listed
// oldest first; assigning one makes the chosen coordinator its only coordinator and takes it out of the queue.
const t = tc("E2E-ASSIGN-01");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
  const older = await data.event({ status: "submitted", coordinator: null, label: "Older request", submittedAt: hoursAgo(2), attendance: 55 });
  const newer = await data.event({ status: "submitted", coordinator: null, label: "Newer request", submittedAt: hoursAgo(1) });

  const lead = await as("lead");
  const queue = new LeadQueuePage(lead);

  await test.step("both requests are listed, oldest first, with who asked and how many (77-AC1 to AC3)", async () => {
    await queue.open();
    await expect(queue.row(older.name)).toBeVisible();
    await expect(queue.row(newer.name)).toBeVisible();
    await expect(queue.row(older.name)).toContainText("Jason Chua");
    await expect(queue.row(older.name)).toContainText("55");

    const rows = await lead.getByRole("row").allInnerTexts();
    const at = (event: { name: string }) => rows.findIndex((text) => text.includes(event.name));
    expect(at(older), "the older request comes before the newer one").toBeLessThan(at(newer));
  });

  await test.step("assigning the older one takes it out of the queue and names the coordinator (78-AC2, AC3)", async () => {
    await queue.assign(older.name, "Marcus Lim");
    await expect(queue.row(older.name)).toHaveCount(0);
    await expect(queue.row(newer.name), "the other request is untouched").toBeVisible();

    const [row] = await data.rest<{ assigned_coordinator_id: string }[]>(`events?select=assigned_coordinator_id&id=eq.${older.id}`);
    expect(row.assigned_coordinator_id).toBe(await data.idOf("coordinator2"));
    const [other] = await data.rest<{ assigned_coordinator_id: string | null }[]>(`events?select=assigned_coordinator_id&id=eq.${newer.id}`);
    expect(other.assigned_coordinator_id).toBeNull();
  });

  await test.step("the coordinator now sees it in their own list", async () => {
    const coordinator = await as("coordinator2");
    await coordinator.goto("/events/review");
    await expect(coordinator.getByText(older.name)).toBeVisible();
  });
});
