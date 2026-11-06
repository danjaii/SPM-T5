import { LeadQueuePage } from "../../pages/ReviewPages";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-184 (docs/specs/lead-system-wide-scope.md), Week 7 change 5: a Lead is system-wide. Both Leads see every unassigned
// request (184-S1) and every coordinator with their workload, including the other Lead's coordinators (184-S2), and can assign
// to any of them (184-S3). Helen Ong supervises Rachel Tan and Marcus Lim; Priya Nair is Samuel Tay's.
// The empty-queue message (SCRUM-77/AC6) is not checked here: the queue is system-wide and other tests keep requests in it
// while this one runs, so it is never empty. The unit tests of the queue list cover that message.
const t = tc("E2E-ASSIGN-04");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const request = await data.event({ status: "submitted", coordinator: null, label: "Request", submittedAt: new Date(Date.now() - 3600e3).toISOString() });

  await test.step("both Leads see the request in the unassigned queue (184-S1)", async () => {
    for (const lead of ["lead", "lead2"] as const) {
      const queue = new LeadQueuePage(await as(lead));
      await queue.open();
      await expect(queue.row(request.name), lead).toBeVisible();
    }
  });

  const helen = await as("lead");
  await test.step("the overview lists the coordinators of both Leads (184-S2)", async () => {
    await helen.goto("/lead/coordinators");
    await expect(helen.getByText("Rachel Tan").first()).toBeVisible(); // Helen's own
    await expect(helen.getByText("Priya Nair").first()).toBeVisible(); // Samuel's
  });

  await test.step("Helen assigns the request to Samuel's coordinator (184-S3)", async () => {
    const queue = new LeadQueuePage(helen);
    await queue.open();
    await queue.assign(request.name, "Priya Nair");
    await expect(queue.row(request.name)).toHaveCount(0);

    const [row] = await data.rest<{ assigned_coordinator_id: string | null }[]>(`events?select=assigned_coordinator_id&id=eq.${request.id}`);
    expect(row.assigned_coordinator_id).toBe(await data.idOf("coordinator3"));
    const logs = await data.rest<{ coordinator_id: string; previous_coordinator_id: string | null }[]>(
      `coordinator_assignment_logs?select=coordinator_id,previous_coordinator_id&event_id=eq.${request.id}`);
    expect(logs).toEqual([{ coordinator_id: await data.idOf("coordinator3"), previous_coordinator_id: null }]);
  });

  await test.step("the Lead sees the assignment on that coordinator's page (184-S2)", async () => {
    await helen.goto(`/lead/coordinators/${await data.idOf("coordinator3")}`);
    await expect(helen.getByText(request.name)).toBeVisible();
  });
});
