import { ChangeRequestFormPage, ChangeReviewPage } from "../../pages/ChangeRequestPages";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-66 (submit) and SCRUM-67 (review): the organiser asks for a change to a live event; the event is untouched until the
// assigned coordinator decides. Approving applies it; rejecting needs a reason, leaves the event as it was, and the organiser
// sees both outcomes.
const t = tc("E2E-CHG-05");

const REASON = "The room cannot take that many people with the stage we agreed.";

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const event = await data.event({ status: "planning", attendance: 50, day: DAY, start: "09:00", end: "17:00" });
  const organiser = await as("organiser");
  const coordinator = await as("coordinator");
  const form = new ChangeRequestFormPage(organiser);
  const review = new ChangeReviewPage(coordinator);

  const requests = () =>
    data.rest<{ id: string; status: string; proposed_changes: Record<string, unknown> }[]>(
      `event_change_requests?select=id,status,proposed_changes&event_id=eq.${event.id}&order=requested_at`,
    );
  const attendance = async () => (await data.rest<{ expected_attendance: number }[]>(`events?select=expected_attendance&id=eq.${event.id}`))[0].expected_attendance;

  let first = "";
  await test.step("the organiser asks for 60 people: it waits, and the event keeps 50 (66-S1, S6)", async () => {
    await form.open(event.id);
    await form.requestAttendance(60);
    await expect(organiser.getByText(/submitted for approval/)).toBeVisible();
    const [req] = await requests();
    expect(req.status).toBe("pending");
    expect(req.proposed_changes, "only the changed field, as from and to").toEqual({ expected_attendance: { from: 50, to: 60 } });
    first = req.id;
    expect(await attendance()).toBe(50);
  });

  await test.step("the coordinator approves it and the event now has 60 (67)", async () => {
    await review.open(first);
    await review.approve();
    await expect.poll(attendance).toBe(60);
    expect((await requests())[0].status).toBe("approved");
  });

  let second = "";
  await test.step("a second request, for 80, is rejected with a reason: the event stays at 60 (67)", async () => {
    await form.open(event.id);
    await form.requestAttendance(80);
    await expect.poll(async () => (await requests()).length).toBe(2);
    second = (await requests())[1].id;

    await review.open(second);
    await review.reject(REASON);
    await expect.poll(async () => (await requests())[1].status).toBe("rejected");
    expect(await attendance()).toBe(60);
    const [row] = await data.rest<{ review_notes: string }[]>(`event_change_requests?select=review_notes&id=eq.${second}`);
    expect(row.review_notes).toBe(REASON);
  });

  await test.step("the organiser sees both outcomes on the event (66-S7)", async () => {
    await organiser.goto(`/events/${event.id}?tab=changes`);
    await expect(organiser.getByText("Approved", { exact: true }).first()).toBeVisible();
    await expect(organiser.getByText("Rejected", { exact: true }).first()).toBeVisible();
    await expect(organiser.getByText(REASON)).toBeVisible();
  });
});
