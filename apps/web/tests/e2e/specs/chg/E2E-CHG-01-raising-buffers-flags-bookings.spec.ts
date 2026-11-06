import { BookingDecisionPage } from "../../pages/BookingPages";
import { VenueAdminPage } from "../../pages/VenueAdminPage";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-104 (Week 7 change 1): Venue Staff raise a venue's setup and turnaround time. Two bookings that fitted before may now
// clash. They are FLAGGED, not removed; a flagged Pending request can only be rejected until the clash is gone; lowering the
// times clears the flags.
const t = tc("E2E-CHG-01");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue(); // no buffers yet
  const summitA = await data.event({ coordinator: "coordinator2", label: "Summit A" });
  const summitB = await data.event({ coordinator: "coordinator", label: "Summit B" });
  // A is Approved 10:00-12:00; B is a Pending request 12:30-14:00: no clash without buffers
  const a = await data.booking({ event: summitA, venue, requestedBy: "coordinator2", day: DAY, start: "10:00", end: "12:00", status: "approved" });
  const b = await data.booking({ event: summitB, venue, requestedBy: "coordinator", day: DAY, start: "12:30", end: "14:00", status: "requested" });

  const venueStaff = await as("venueStaff");
  const admin = new VenueAdminPage(venueStaff);
  const decision = new BookingDecisionPage(venueStaff);
  const openFlags = async () =>
    data.rest<{ booking_id: string; kind: string }[]>(`venue_booking_flags?select=booking_id,kind&resolved_at=is.null&booking_id=in.(${a.id},${b.id})`);

  await test.step("raising the times to 30 and 45 minutes flags both bookings and says which clash (104-S1)", async () => {
    await admin.open(venue.id);
    const form = await admin.setTimes(30, 45);
    await expect(form.getByText(`${summitA.name} (occupies until 12:45) now conflicts with ${summitB.name} (occupies from 12:00)`)).toBeVisible();
    await expect(form.getByText(/Nothing was cancelled or withdrawn/)).toBeVisible();

    const flags = await openFlags();
    expect(flags.map((f) => f.booking_id).sort(), "one flag on each booking").toEqual([a.id, b.id].sort());
    expect(flags.every((f) => f.kind === "buffer_conflict")).toBe(true);
  });

  await test.step("neither booking was removed or decided (104-S2)", async () => {
    const rows = await data.rest<{ id: string; status: string }[]>(`venue_bookings?select=id,status&id=in.(${a.id},${b.id})`);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({ [a.id]: "approved", [b.id]: "requested" });
  });

  await test.step("a flagged Pending request cannot be approved, only rejected (104-S4)", async () => {
    await decision.open(b.id);
    await expect(venueStaff.getByLabel("Flags")).toContainText("Flagged: Buffer conflict");
    await expect(venueStaff.getByRole("button", { name: "Approve request" })).toHaveCount(0);
    await expect(venueStaff.getByRole("button", { name: "Reject request" })).toBeVisible();
  });

  await test.step("lowering the times to 15 and 15 clears both flags and Approve is back (104-S5)", async () => {
    await admin.open(venue.id);
    await admin.setTimes(15, 15);
    expect(await openFlags(), "no open flags").toEqual([]);
    const resolved = await data.rest<{ resolved_reason: string }[]>(`venue_booking_flags?select=resolved_reason&booking_id=in.(${a.id},${b.id})`);
    // spec 104 decision: one reason, no_longer_conflicts (its 104-S5 table row still shows the superseded name padding_changed)
    expect(resolved.map((r) => r.resolved_reason)).toEqual(["no_longer_conflicts", "no_longer_conflicts"]);

    await decision.open(b.id);
    await expect(venueStaff.getByRole("button", { name: "Approve request" })).toBeVisible();
  });
});
