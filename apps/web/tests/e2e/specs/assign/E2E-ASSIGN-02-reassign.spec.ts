import { callAs } from "../../fixtures/api";
import { SERVICE_URL } from "../../fixtures/env";
import { LeadAssignPage } from "../../pages/ReviewPages";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-79 and SCRUM-156-S4: when a Lead reassigns an event, the new coordinator can read it and the previous one no longer can.
// SCRUM-47/AC1 (47-S1): the new coordinator is told; the replaced coordinator and the Lead who made the change are not.
const t = tc("E2E-ASSIGN-02");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const event = await data.event({ coordinator: "coordinator", status: "under_review" });
  const url = `${SERVICE_URL.event}/events/${event.id}`;
  const previous = await as("coordinator");
  const next = await as("coordinator2");

  await test.step("before: the first coordinator reads the event and the second cannot", async () => {
    expect((await callAs(previous, "GET", url)).status).toBe(200);
    expect((await callAs(next, "GET", url)).status).toBe(404);
  });

  await test.step("the Lead reassigns it", async () => {
    const lead = await as("lead");
    const assign = new LeadAssignPage(lead);
    await assign.open(event.id, "reassign");
    await assign.choose("Marcus Lim");
    await assign.confirm("reassign");
    await expect
      .poll(async () => (await data.rest<{ assigned_coordinator_id: string }[]>(`events?select=assigned_coordinator_id&id=eq.${event.id}`))[0].assigned_coordinator_id)
      .toBe(await data.idOf("coordinator2"));
  });

  await test.step("after: the new coordinator reads the event and the previous one no longer can (156-S4)", async () => {
    expect((await callAs(next, "GET", url)).status).toBe(200);
    expect((await callAs(previous, "GET", url)).status).toBe(404);
  });

  await test.step("only the new coordinator is told: not the replaced one, nor the Lead who did it (47-S1)", async () => {
    const told = (await data.rest<{ user_id: string }[]>(`notifications?select=user_id&event_id=eq.${event.id}&type=eq.coordinator_assigned`)).map((n) => n.user_id);
    expect(told).toEqual([await data.idOf("coordinator2")]);
  });
});
