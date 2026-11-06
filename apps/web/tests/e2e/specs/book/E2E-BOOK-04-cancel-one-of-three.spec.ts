import { EventBookingsPage } from "../../pages/BookingPages";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-98 and SCRUM-102 (Week 7 change 3): one event can hold several venues, each on its own. Cancelling one with a reason
// leaves the other two and the event's status as they were.
const t = tc("E2E-BOOK-04");

const REASON = "The partner session moved online.";

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const event = await data.event({ status: "approved" });
  const hall = await data.venue({ label: "Hall" });
  const room = await data.venue({ label: "Room" });
  const lobby = await data.venue({ label: "Lobby" });
  const hallBooking = await data.booking({ event, venue: hall, requestedBy: "coordinator", day: DAY, start: "09:00", end: "12:00", status: "approved" });
  const roomBooking = await data.booking({ event, venue: room, requestedBy: "coordinator", day: DAY, start: "10:00", end: "11:00", status: "approved" });
  const lobbyBooking = await data.booking({ event, venue: lobby, requestedBy: "coordinator", day: DAY, start: "13:00", end: "15:00", status: "requested" });

  const coordinator = await as("coordinator");
  const bookings = new EventBookingsPage(coordinator);

  await test.step("the event page lists all three venues (98-S24)", async () => {
    await bookings.open(event.id);
    for (const v of [hall, room, lobby]) await expect(coordinator.getByRole("link", { name: v.name, exact: true })).toBeVisible();
  });

  await test.step("cancelling the Room booking with a reason (102-S12)", async () => {
    await bookings.cancel(room.name, REASON);
    await expect.poll(async () => (await data.bookingsOf(event)).find((b) => b.id === roomBooking.id)?.status).toBe("cancelled");
    const [row] = await data.rest<{ cancellation_reason: string; cancelled_by: string }[]>(`venue_bookings?select=cancellation_reason,cancelled_by&id=eq.${roomBooking.id}`);
    expect(row.cancellation_reason).toBe(REASON);
    expect(row.cancelled_by).toBe(await data.idOf("coordinator"));
  });

  await test.step("the other two bookings and the event are untouched (98-S17, 102-S20)", async () => {
    const now = await data.bookingsOf(event);
    expect(now.find((b) => b.id === hallBooking.id)?.status).toBe("approved");
    expect(now.find((b) => b.id === lobbyBooking.id)?.status).toBe("requested");
    const [row] = await data.rest<{ status: string }[]>(`events?select=status&id=eq.${event.id}`);
    expect(row.status, "cancelling a venue does not cancel the event").toBe("approved");

    await bookings.open(event.id);
    await expect(coordinator.getByText(REASON)).toBeVisible();
  });
});
