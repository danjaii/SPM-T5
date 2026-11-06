import { callAs } from "../../fixtures/api";
import { SERVICE_URL } from "../../fixtures/env";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-156 (Week 7 change 5): a coordinator works only with the events assigned to them. Another coordinator does not see the
// event in their list, cannot open it, and cannot change its status; nothing changes.
const t = tc("E2E-ACL-03");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const event = await data.event({ coordinator: "coordinator", status: "submitted", label: "Rachel's event" });
  const owner = await as("coordinator");
  const other = await as("coordinator2");
  const status = async () => (await data.rest<{ status: string }[]>(`events?select=status&id=eq.${event.id}`))[0].status;

  await test.step("the assigned coordinator sees it in their list and can open it", async () => {
    await owner.goto("/events/review");
    await expect(owner.getByText(event.name).first()).toBeVisible();
    expect((await callAs(owner, "GET", `${SERVICE_URL.event}/events/${event.id}`)).status).toBe(200);
  });

  await test.step("another coordinator does not see it in their list (156-S1)", async () => {
    await other.goto("/events/review");
    await expect(other.getByRole("heading", { name: "Event requests" })).toBeVisible();
    await expect(other.getByText(event.name)).toHaveCount(0);
  });

  await test.step("and cannot read it: the event looks like one that does not exist (156-S8)", async () => {
    expect((await callAs(other, "GET", `${SERVICE_URL.event}/events/${event.id}`)).status).toBe(404);
    await other.goto(`/events/${event.id}`);
    await expect(other.getByRole("button", { name: "Start review" })).toHaveCount(0);
    await expect(other.getByText(event.name)).toHaveCount(0);
  });

  await test.step("and cannot change its status; nothing changes", async () => {
    const res = await callAs(other, "PATCH", `${SERVICE_URL.event}/events/${event.id}/status`, { status: "under_review" });
    expect([403, 404], `answered ${res.status}`).toContain(res.status);
    expect(await status()).toBe("submitted");
  });
});
