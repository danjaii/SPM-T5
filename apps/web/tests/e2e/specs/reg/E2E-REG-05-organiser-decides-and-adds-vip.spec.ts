import { waitForButton } from "../../fixtures/hydration";
import { AttendeePages } from "../../pages/AttendeePages";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-169 and SCRUM-170, and the customer's answers (Week 4: "registration is governed by overall venue/event capacity, though VIPs
// may be added manually even when normal registration is full"; Week 9: "organisers can make final decision if exceed capacity"):
// when an event is full, a further attendee waits for the organiser. The organiser cannot Confirm that attendee while it is full
// (a place must be freed first), can Decline, and can add a VIP past the cap, up to the venue's capacity. The page is reloaded before each
// check of the list: with a waiting attendee on it the production build does not refresh the list after Add VIP (defect D-006, which
// E2E-REG-06 asserts), and this case is about the rules, not the refresh.
const t = tc("E2E-REG-05");
const VIP = "chen.wei.jie@example.com";

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue({ capacity: 5, label: "Small hall" }); // the VIP limit is the smallest approved venue's capacity
  const event = await data.event({ status: "confirmed", day: DAY, start: "09:00", end: "17:00", registration: { capacity: 1 }, label: "Full event" });
  await data.booking({ event, venue, requestedBy: "coordinator", day: DAY, start: "09:00", end: "17:00", status: "approved" });
  const statusOf = async (email: string) => (await data.rest<{ status: string }[]>(
    `event_registrations?select=status&event_id=eq.${event.id}&attendee_id=eq.${await data.userId(email)}`))[0]?.status;

  await test.step("the first attendee takes the only place; the second is told the event is full and waits for the organiser (SCRUM-169)", async () => {
    const first = new AttendeePages(await as("attendee"));
    await (await first.findRegisterButton(event.id, event.name)).click();
    await first.register({ name: "Alicia Fernandez", email: "alicia.fernandez@example.com", phone: "91234567" });
    await expect(first.registered).toContainText("Confirmed");

    const secondPage = await as("attendee2");
    const second = new AttendeePages(secondPage);
    await (await second.findRegisterButton(event.id, event.name)).click();
    await second.register({ name: "Bryan Ho", email: "bryan.ho@example.com", phone: "98765432" });
    await expect(secondPage.getByRole("status").filter({ hasText: "This event is full" })).toBeVisible();
  });

  const organiser = await as("organiser");
  const bryan = () => organiser.getByRole("row").filter({ hasText: "bryan.ho@example.com" });

  await test.step("the organiser adds a VIP past the cap, up to the venue's capacity (SCRUM-170)", async () => {
    await organiser.goto(`/registrations-overview?event=${event.id}`);
    await waitForButton(organiser, "Add VIP"); // a value typed before React has attached is thrown away
    await organiser.getByLabel("Attendee's email").fill(VIP);
    await organiser.getByRole("button", { name: "Add VIP" }).click();
    await expect(organiser.getByRole("status").filter({ hasText: `${VIP} is now Confirmed as a VIP.` })).toBeVisible();
    await organiser.reload(); // D-006: the list is not refreshed by the page itself in the production build
    await expect(organiser.getByRole("row").filter({ hasText: VIP })).toContainText("VIP");
    expect(await statusOf(VIP)).toBe("registered");
    const confirmed = await data.rest<unknown[]>(`event_registrations?select=id&event_id=eq.${event.id}&status=eq.registered`);
    expect(confirmed, "two confirmed on an event whose registration cap is 1").toHaveLength(2);
  });

  await test.step("Confirm is refused for the waiting attendee while the event is full (169/AC3, AC4)", async () => {
    await expect(bryan()).toContainText("Pending");
    await waitForButton(organiser, "Confirm"); // a click before React has attached to the row's button is lost
    await bryan().getByRole("button", { name: "Confirm" }).click();
    await expect(organiser.getByText("This event is full. A place must be freed before you can confirm this registration.")).toBeVisible();
    expect(await statusOf("bryan.ho@example.com"), "he is still waiting").not.toBe("registered");
  });

  await test.step("the organiser declines the waiting attendee, who no longer waits (169/AC3)", async () => {
    await waitForButton(organiser, "Decline");
    const decided = organiser.waitForResponse((r) => r.url().includes("/decision") && r.request().method() === "POST");
    await bryan().getByRole("button", { name: "Decline" }).click();
    expect((await decided).ok(), "the decision was accepted").toBe(true);
    await organiser.reload(); // D-006 (see above)
    await expect(bryan()).toContainText("Rejected");
    await expect(bryan().getByRole("button", { name: "Confirm" })).toHaveCount(0);
  });
});
