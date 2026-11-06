import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-46: the header bell shows how many notifications are unread, the list shows each one (unread ones marked in words, not
// colour alone), "Mark as read" changes one, and "Open" goes to what it is about and marks it read.
const t = tc("E2E-NOTIF-01");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const event = await data.event();
  const recipient = await data.idOf("attendee3"); // an account no other spec writes to, so the bell can be compared with the database exactly
  // attendees are told about events they are registered for; without a registration the list says they no longer have access
  await data.insert("event_registrations", {
    event_id: event.id, attendee_id: recipient, status: "registered",
    registration_details: { name: "Dylan Heng", email: "dylan.heng@example.com", phone: "91234567" },
  });
  const approved = await data.insert("notifications", {
    user_id: recipient, event_id: event.id, type: "event_confirmed", title: "An event was confirmed", message: `${event.name} is confirmed.`,
  });
  const decision = await data.insert("notifications", {
    user_id: recipient, event_id: event.id, type: "event_changed", title: "An event was changed", message: `${event.name} has a new start time.`,
  });
  const unreadInDb = async () => (await data.rest<{ id: string }[]>(`notifications?select=id&user_id=eq.${recipient}&is_read=eq.false`)).length;
  const isRead = async (id: string) => (await data.rest<{ is_read: boolean; read_at: string | null }[]>(`notifications?select=is_read,read_at&id=eq.${id}`))[0];

  const page = await as("attendee3");
  const bell = () => page.getByRole("button", { name: /^Notifications(, \d+ unread)?$/ });
  const bellCount = async () => Number(/(\d+) unread/.exec((await bell().getAttribute("aria-label")) ?? "")?.[1] ?? 0);
  const row = (title: string) => page.getByRole("listitem").filter({ hasText: event.name }).filter({ hasText: title });

  await test.step("the bell counts exactly the unread notifications", async () => {
    await page.goto("/notifications");
    await expect(bell()).toBeVisible();
    const expected = await unreadInDb();
    expect(expected, "the two notifications this test made are among them").toBeGreaterThanOrEqual(2);
    await expect.poll(bellCount).toBe(expected);
  });

  await test.step("both notifications are listed, and unread ones say so in words", async () => {
    await expect(row("An event was confirmed")).toContainText("Unread");
    await expect(row("An event was changed")).toContainText("Unread");
  });

  await test.step("Mark as read changes one notification, and after a reload the bell is down by one", async () => {
    const before = await bellCount();
    await row("An event was confirmed").getByRole("button", { name: "Mark as read" }).click();
    await expect.poll(async () => (await isRead(approved.id)).is_read).toBe(true);
    expect((await isRead(approved.id)).read_at).not.toBeNull();
    expect((await isRead(decision.id)).is_read, "the other is still unread").toBe(false);
    await expect(row("An event was confirmed")).not.toContainText("Mark as read");
    // the header bell reads its count when the page loads and does not follow a change made in the list, so look again after a reload
    await page.reload();
    await expect.poll(bellCount).toBe(before - 1);
  });

  await test.step("Open goes to My registrations and marks that notification read", async () => {
    await row("An event was changed").getByRole("button", { name: /^An event was changed/ }).click(); // the whole row is the Open control
    // an attendee cannot read the event itself, so an event notification opens their registrations (spec 172)
    await expect(page).toHaveURL(/\/registrations/, { timeout: 90_000 }); // `next dev` compiles /registrations on this first visit
    await expect.poll(async () => (await isRead(decision.id)).is_read).toBe(true);
  });
});
