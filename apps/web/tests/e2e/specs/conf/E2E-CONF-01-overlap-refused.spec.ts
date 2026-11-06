import { VenueRequestPage } from "../../pages/VenueRequestPage";
import { DAY, heldVenue } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-36 (DR5) and SCRUM-103-S6: a request that overlaps another event's holding booking is refused, naming the occupied
// period; the venue has no setup or turnaround here, so the message has no "including setup and turnaround" suffix.
const t = tc("E2E-CONF-01");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const page = await as("coordinator");
  const form = new VenueRequestPage(page);

  // the holder is Pending in one case and Approved in the other: both hold the venue (36-S1)
  for (const holderStatus of ["approved", "requested"] as const) {
    await test.step(`holder is ${holderStatus}: overlapping requests are refused and nothing is created`, async () => {
      const { venue, requester } = await heldVenue(data, { holderStatus });

      // holder occupies 10:00-12:00: a request that runs into its end, and one that runs into its start
      for (const [start, end] of [["11:00", "13:00"], ["09:00", "10:30"]]) {
        await form.open(requester.id);
        await form.fill({ venueName: venue.name, capacity: venue.max_capacity, date: DAY, start, end });
        await form.submit();

        // An Approved holder is "occupied". A Pending holder is a tentative hold, which SCRUM-97 words as "tentatively held", but the
        // product also answers "occupied" for it in some runs (two code paths: the service's pre-check and the database trigger; see
        // defects.md D-007). Either way the request is refused, names the period and creates nothing, which is what this case checks.
        const wording = holderStatus === "requested" ? "(tentatively held|occupied)" : "occupied";
        await expect(form.refusal, `${start}-${end}`).toContainText(new RegExp(`${venue.name} is ${wording} from 10:00 to 12:00`));
        await expect(form.refusal).not.toContainText("including setup and turnaround");
        await expect(page).toHaveURL(/\/venue-request$/); // stayed on the form
      }

      expect(await data.bookingsOf(requester), "no booking was created for the requesting event").toEqual([]);
    });
  }
});
