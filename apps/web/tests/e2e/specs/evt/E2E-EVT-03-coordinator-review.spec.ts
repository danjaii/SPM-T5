import { EventReviewPage, ReviewDialogs } from "../../pages/ReviewPages";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-24, 44, 45 (coordinator review; no written ACs in docs/specs, so these follow the Jira stories as built): the assigned
// coordinator starts a review, can ask the organiser a question, and approves or rejects. A rejection needs a reason, which the
// organiser sees; each decision tells the organiser.
const t = tc("E2E-EVT-03");

const QUESTION = "Can you confirm whether the catering needs a halal kitchen?";
const REASON = "The date clashes with the venue's annual closure.";

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const asked = await data.event({ status: "submitted", label: "Needs a question" });
  const rejected = await data.event({ status: "under_review", label: "To reject" });
  const approved = await data.event({ status: "under_review", label: "To approve" });
  const statusOf = async (id: string) => (await data.rest<{ status: string }[]>(`events?select=status&id=eq.${id}`))[0].status;
  const told = async (id: string, type: string) =>
    (await data.rest<{ user_id: string }[]>(`notifications?select=user_id&event_id=eq.${id}&type=eq.${type}`)).map((n) => n.user_id);

  const coordinator = await as("coordinator");
  const organiser = await as("organiser");
  const review = new EventReviewPage(coordinator);
  const dialogs = new ReviewDialogs(coordinator);
  const organiserId = await data.idOf("organiser");

  await test.step("Start review moves a submitted request to Under Review (45)", async () => {
    await review.open(asked.id);
    await review.startReview();
    await expect.poll(() => statusOf(asked.id)).toBe("under_review");
  });

  await test.step("a question to the organiser is sent, and the organiser is told and can read it", async () => {
    await dialogs.requestClarification(QUESTION);
    await expect.poll(() => told(asked.id, "clarification_requested")).toEqual([organiserId]);
    await organiser.goto(`/events/${asked.id}`);
    await expect(organiser.getByText(QUESTION)).toBeVisible();
  });

  await test.step("rejecting with a reason moves the request to Rejected and the organiser sees why (44)", async () => {
    await review.open(rejected.id);
    await dialogs.reject(REASON);
    await expect.poll(() => statusOf(rejected.id)).toBe("rejected");
    expect(await told(rejected.id, "event_rejected")).toEqual([organiserId]);
    await organiser.goto(`/events/${rejected.id}`);
    await expect(organiser.getByText(REASON)).toBeVisible();
  });

  await test.step("approving moves it to Approved and tells the organiser (24)", async () => {
    await review.open(approved.id);
    await review.approve();
    await expect.poll(() => statusOf(approved.id)).toBe("approved");
    expect(await told(approved.id, "event_approved")).toEqual([organiserId]);
  });
});
