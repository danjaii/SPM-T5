import { VenueRequestPage } from "../../pages/VenueRequestPage";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-109 and SCRUM-110: "Check suitability" on the request form says whether a venue suits the event, and why not. It is
// information only: an unsuitable venue can still be requested, but only after giving a reason, which is kept.
const t = tc("E2E-VEN-02");

const OVERRIDE = "The partner insists on this hall; we will limit entry to 100.";

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const event = await data.event({ attendance: 150 });
  const roomy = await data.venue({ capacity: 200, label: "Roomy hall" });
  const small = await data.venue({ capacity: 100, label: "Small hall" });

  const coordinator = await as("coordinator");
  const form = new VenueRequestPage(coordinator);
  const report = coordinator.getByRole("region", { name: "Venue suitability" });
  const times = { date: DAY, start: "10:00", end: "12:00" };

  await test.step("a venue that holds enough is Suitable (109)", async () => {
    await form.open(event.id);
    await form.fill({ venueName: roomy.name, capacity: roomy.max_capacity, ...times });
    await coordinator.getByRole("button", { name: "Check suitability" }).click();
    await expect(report).toContainText("Suitable");
    await expect(report).not.toContainText("Not suitable");
  });

  await test.step("a venue that is too small is Not suitable and says what is not met", async () => {
    await form.fill({ venueName: small.name, capacity: small.max_capacity, ...times });
    await coordinator.getByRole("button", { name: "Check suitability" }).click();
    await expect(report).toContainText("Not suitable");
    await expect(report).toContainText("Not met");
  });

  await test.step("requesting it anyway asks for a reason first, and nothing is created without one (110)", async () => {
    await form.submit();
    await expect(coordinator.getByText("This venue does not suit the event")).toBeVisible();
    await coordinator.getByRole("button", { name: "Submit anyway" }).click();
    await expect(coordinator).not.toHaveURL(/\/venue-bookings\//);
    expect(await data.bookingsOf(event), "no booking without a reason").toEqual([]);
  });

  await test.step("with a reason the request is created and the reason is kept", async () => {
    await coordinator.getByLabel("Reason for requesting it anyway").fill(OVERRIDE);
    await coordinator.getByRole("button", { name: "Submit anyway" }).click();
    await expect(coordinator).toHaveURL(/\/venue-bookings\/[0-9a-f-]+$/);
    const rows = await data.rest<{ status: string; suitability_override_reason: string }[]>(`venue_bookings?select=status,suitability_override_reason&event_id=eq.${event.id}`);
    expect(rows).toEqual([{ status: "requested", suitability_override_reason: OVERRIDE }]);
  });
});
