import { EquipmentQueuePage, EventEquipmentPage } from "../../pages/EquipmentJourneyPages";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-86, 87, 88: the coordinator asks for equipment against an approved venue booking; Technical Support review the request
// and move it on. "Cannot Fulfil" needs a reason, which the coordinator then sees on the event's Equipment tab.
const t = tc("E2E-EQP-03");

const REASON = "All of this model is out on loan until January.";

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue();
  const item = await data.equipment({ totalQuantity: 5 });
  const event = await data.event({ day: DAY, start: "09:00", end: "17:00" });
  await data.booking({ event, venue, requestedBy: "coordinator", day: DAY, start: "09:00", end: "17:00", status: "approved" });

  const coordinator = await as("coordinator");
  const tech = await as("tech");
  const equipment = new EventEquipmentPage(coordinator);
  const queue = new EquipmentQueuePage(tech);
  const stored = async () => (await data.rest<{ status: string; review_reason: string | null }[]>(`equipment_reservations?select=status,review_reason&equipment_id=eq.${item.id}`))[0];

  await test.step("the coordinator adds the item and it is Submitted (86)", async () => {
    await equipment.addItem(event.id, item.name, 2);
    await expect(equipment.row(item.name)).toContainText("Submitted");
    expect((await stored()).status).toBe("requested");
  });

  await test.step("Technical Support set it to Cannot Fulfil with a reason (87, 88)", async () => {
    await queue.open(event.id);
    await queue.setStatus(item.name, "Cannot Fulfil", REASON);
    await expect.poll(async () => (await stored()).review_reason).toBe(REASON);
  });

  await test.step("the coordinator sees the status and the reason on the Equipment tab", async () => {
    await coordinator.goto(`/events/${event.id}?tab=equipment`);
    await expect(equipment.row(item.name)).toContainText("Cannot Fulfil");
    await expect(coordinator.getByText(REASON)).toBeVisible();
  });
});
