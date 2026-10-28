import request from "supertest";
import { describe, expect, it } from "vitest";
import { sgtToUtc } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import { aCalendarVenue, createFakeSession, FakeVenueCalendarReader } from "../support/fakeCalendar";

const NOW = sgtToUtc("2026-11-11", "11:00");
const at = (time: string) => sgtToUtc("2026-11-14", time);

function arrange() {
  const reader = new FakeVenueCalendarReader([aCalendarVenue()]);
  const session = createFakeSession();
  const app = createApp(session.deps, { now: () => NOW, venueCalendar: () => reader });
  const cookie = session.signIn("event_coordinator").cookie;
  const statuses = async () => {
    const res = await request(app).get("/venue-calendar?from=2026-11-14").set("Cookie", cookie);
    return { res, statuses: (res.body.venues[0].periods as { status: string }[]).map((p) => p.status) };
  };
  return { reader, statuses };
}

describe("SCRUM-84/AC7 the latest recorded status", () => {
  it("S1: the response is never cached", async () => {
    const { statuses } = arrange();
    expect((await statuses()).res.headers["cache-control"]).toBe("no-store");
  });

  it("S2: a hold recorded after the first call shows in the second", async () => {
    const { reader, statuses } = arrange();
    expect((await statuses()).statuses).toEqual(["AVAILABLE"]);

    reader.hold("orchid", "TENTATIVELY_HELD", at("10:00"), at("12:00"));

    expect((await statuses()).statuses).toEqual(["AVAILABLE", "TENTATIVELY_HELD", "AVAILABLE"]);
  });

  it("S2: a hold that is then approved changes to Confirmed on reload", async () => {
    const { reader, statuses } = arrange();
    reader.hold("orchid", "TENTATIVELY_HELD", at("10:00"), at("12:00"));
    await statuses();

    reader.bookings[0]!.status = "CONFIRMED";

    expect((await statuses()).statuses).toEqual(["AVAILABLE", "CONFIRMED", "AVAILABLE"]);
  });

  it("S2: a block recorded after the first call shows in the second", async () => {
    const { reader, statuses } = arrange();
    await statuses();

    reader.block("orchid", at("08:00"), at("16:00"));

    expect((await statuses()).statuses).toEqual(["AVAILABLE", "BLOCKED", "AVAILABLE"]);
  });

  it("S2: a booking cancelled after the first call is gone on reload", async () => {
    const { reader, statuses } = arrange();
    reader.hold("orchid", "CONFIRMED", at("10:00"), at("12:00"));
    await statuses();

    reader.bookings.length = 0;

    expect((await statuses()).statuses).toEqual(["AVAILABLE"]);
  });
});
