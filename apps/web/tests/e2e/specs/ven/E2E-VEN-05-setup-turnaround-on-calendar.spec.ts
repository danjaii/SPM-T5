import { VenueAdminPage } from "../../pages/VenueAdminPage";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-101 and SCRUM-103/AC5 (Week 7 change 1): Venue Staff set a venue's setup and turnaround time; a booking then occupies
// its period plus both. The venue's availability page shows the three parts apart and the whole occupied period.
const t = tc("E2E-VEN-05");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue(); // 0 and 0 to start with
  const event = await data.event();
  await data.booking({ event, venue, requestedBy: "coordinator", day: DAY, start: "10:00", end: "12:00", status: "approved" });

  const venueStaff = await as("venueStaff");
  const admin = new VenueAdminPage(venueStaff);
  const coordinator = await as("coordinator");

  await test.step("with no setup or turnaround the booking occupies just its own period", async () => {
    await coordinator.goto(`/venues/${venue.id}/availability?date=${DAY}`);
    await expect(coordinator.getByText("Occupied 10:00 to 12:00")).toBeVisible();
    await expect(coordinator.getByText(/^Setup /)).toHaveCount(0);
  });

  await test.step("Venue Staff save 30 minutes setup and 45 minutes turnaround (101)", async () => {
    await admin.open(venue.id);
    await admin.setTimes(30, 45);
    const [row] = await data.rest<{ setup_minutes: number; turnaround_minutes: number }[]>(`venues?select=setup_minutes,turnaround_minutes&id=eq.${venue.id}`);
    expect(row).toEqual({ setup_minutes: 30, turnaround_minutes: 45 });
  });

  await test.step("the availability page now shows setup, event and turnaround apart, occupying 09:30 to 12:45 (103-S5)", async () => {
    await coordinator.goto(`/venues/${venue.id}/availability?date=${DAY}`);
    await expect(coordinator.getByText("Occupied 09:30 to 12:45")).toBeVisible();
    await expect(coordinator.getByText("Setup 09:30 to 10:00")).toBeVisible();
    await expect(coordinator.getByText("Event 10:00 to 12:00")).toBeVisible();
    await expect(coordinator.getByText("Turnaround 12:00 to 12:45")).toBeVisible();
  });
});
