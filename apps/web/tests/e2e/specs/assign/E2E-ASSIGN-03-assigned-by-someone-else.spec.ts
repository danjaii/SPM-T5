import { callAs } from "../../fixtures/api";
import { SERVICE_URL } from "../../fixtures/env";
import { LeadAssignPage } from "../../pages/ReviewPages";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-78-AC5: a Lead has the assign page open; another Lead assigns the event meanwhile; the first Lead's confirm is
// refused, the Lead is told it is already assigned, and the existing assignment is unchanged.
const t = tc("E2E-ASSIGN-03");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const event = await data.event({ status: "submitted", coordinator: null, submittedAt: new Date(Date.now() - 3600e3).toISOString() });
  const priya = await data.idOf("coordinator3");

  const first = await as("lead");
  const second = await as("lead2");
  const page = new LeadAssignPage(first);

  await page.open(event.id, "assign");
  await page.choose("Marcus Lim"); // chosen, not yet confirmed

  await test.step("meanwhile the other Lead assigns it to someone else", async () => {
    const res = await callAs(second, "POST", `${SERVICE_URL.event}/lead/events/${event.id}/assign`, { coordinator_id: priya });
    expect(res.status).toBe(200);
  });

  await test.step("the first Lead confirms and is refused", async () => {
    await page.confirm("assign");
    await expect(first.getByRole("alert").filter({ hasText: "already been assigned" })).toBeVisible();
    const [row] = await data.rest<{ assigned_coordinator_id: string }[]>(`events?select=assigned_coordinator_id&id=eq.${event.id}`);
    expect(row.assigned_coordinator_id, "the first assignment stands").toBe(priya);
  });
});
