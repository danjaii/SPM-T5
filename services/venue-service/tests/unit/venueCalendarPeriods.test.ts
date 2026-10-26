import request from "supertest";
import { describe, expect, it } from "vitest";
import { sgtToUtc } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import { aCalendarVenue, createFakeSession, FakeVenueCalendarReader } from "../support/fakeCalendar";

// Wednesday 11 Nov 2026, so the default range is the week of 9 to 15 November. The venue has no operating hours (open all day).
const NOW = sgtToUtc("2026-11-11", "11:00");
const at = (time: string, date = "2026-11-14") => sgtToUtc(date, time);
const iso = (d: Date) => d.toISOString();

function arrange(venue = aCalendarVenue()) {
  const reader = new FakeVenueCalendarReader([venue]);
  const session = createFakeSession();
  const app = createApp(session.deps, { now: () => NOW, venueCalendar: () => reader });
  const get = async () => {
    const res = await request(app).get("/venue-calendar").set("Cookie", session.signIn("event_coordinator").cookie);
    return res.body.venues[0].periods as Record<string, unknown>[];
  };
  return { reader, get };
}
const week = { start: iso(sgtToUtc("2026-11-09", "00:00")), end: iso(sgtToUtc("2026-11-16", "00:00")) };
const open = (start: string, end: string) => ({ kind: "open", status: "AVAILABLE", label: "Available", start, end });

describe("SCRUM-84/AC2 held, confirmed and blocked periods", () => {
  it("S1: a held request shows as Tentatively Held with its start and end", async () => {
    const { reader, get } = arrange();
    reader.hold("orchid", "TENTATIVELY_HELD", at("10:00"), at("12:00"));

    const periods = await get();

    expect(periods).toContainEqual({
      kind: "event",
      status: "TENTATIVELY_HELD",
      label: "Tentatively Held",
      start: iso(at("10:00")),
      end: iso(at("12:00")),
      event_start: iso(at("10:00")),
      event_end: iso(at("12:00")),
      occupied_start: iso(at("10:00")),
      occupied_end: iso(at("12:00")),
      setup_minutes: 0,
      turnaround_minutes: 0,
    });
  });

  it("S1: an approved booking shows as Confirmed, and the free time around it stays Available", async () => {
    const { reader, get } = arrange();
    reader.hold("orchid", "CONFIRMED", at("10:00"), at("12:00"));

    const periods = await get();

    expect(periods.map((p) => [p.status, p.label, p.start, p.end])).toEqual([
      ["AVAILABLE", "Available", week.start, iso(at("10:00"))],
      ["CONFIRMED", "Confirmed", iso(at("10:00")), iso(at("12:00"))],
      ["AVAILABLE", "Available", iso(at("12:00")), week.end],
    ]);
  });

  it("S1/S3: a block shows as Blocked with its reason key and label, and nothing else about it", async () => {
    const { reader, get } = arrange();
    reader.block("orchid", at("08:00"), at("16:00"), "equipment_failure");

    const periods = await get();

    expect(periods).toContainEqual({
      kind: "block",
      status: "BLOCKED",
      label: "Blocked",
      start: iso(at("08:00")),
      end: iso(at("16:00")),
      reason: "equipment_failure",
      reason_label: "Equipment failure",
    });
  });

  it("S3: a reason the service does not know still shows, labelled Other", async () => {
    const { reader, get } = arrange();
    reader.block("orchid", at("08:00"), at("16:00"), "something_new");

    const block = (await get()).find((p) => p.kind === "block");

    expect(block).toMatchObject({ reason: "something_new", reason_label: "Other" });
  });

  it("S4: a booking 10:00-12:00 with 30 minutes setup and 45 turnaround is setup, event and turnaround, none Available", async () => {
    const { reader, get } = arrange(aCalendarVenue({ setupMinutes: 30, turnaroundMinutes: 45 }));
    reader.hold("orchid", "CONFIRMED", at("10:00"), at("12:00"));

    const periods = await get();

    expect(periods.map((p) => [p.kind, p.status, p.start, p.end])).toEqual([
      ["open", "AVAILABLE", week.start, iso(at("09:30"))],
      ["setup", "CONFIRMED", iso(at("09:30")), iso(at("10:00"))],
      ["event", "CONFIRMED", iso(at("10:00")), iso(at("12:00"))],
      ["turnaround", "CONFIRMED", iso(at("12:00")), iso(at("12:45"))],
      ["open", "AVAILABLE", iso(at("12:45")), week.end],
    ]);
    expect(periods[2]).toMatchObject({
      event_start: iso(at("10:00")),
      event_end: iso(at("12:00")),
      occupied_start: iso(at("09:30")),
      occupied_end: iso(at("12:45")),
      setup_minutes: 30,
      turnaround_minutes: 45,
    });
  });

  it("S5: a block over a booking wins; a held request beside a confirmed one keeps both", async () => {
    const { reader, get } = arrange();
    reader.hold("orchid", "CONFIRMED", at("10:00"), at("12:00"));
    reader.hold("orchid", "TENTATIVELY_HELD", at("12:00"), at("13:00"));
    reader.block("orchid", at("11:00"), at("12:30"));

    const periods = await get();

    expect(periods.map((p) => [p.status, p.start, p.end])).toEqual([
      ["AVAILABLE", week.start, iso(at("10:00"))],
      ["CONFIRMED", iso(at("10:00")), iso(at("11:00"))],
      ["BLOCKED", iso(at("11:00")), iso(at("12:30"))],
      ["TENTATIVELY_HELD", iso(at("12:30")), iso(at("13:00"))],
      ["AVAILABLE", iso(at("13:00")), week.end],
    ]);
  });

  it("S5: a confirmed event beats the setup of the next, and a block takes the setup and turnaround too", async () => {
    const { reader, get } = arrange(aCalendarVenue({ setupMinutes: 30, turnaroundMinutes: 30 }));
    reader.hold("orchid", "TENTATIVELY_HELD", at("10:00"), at("11:00")); // occupied 09:30-11:30
    reader.block("orchid", at("11:15"), at("11:45"));

    const periods = await get();

    expect(periods.map((p) => [p.kind, p.start, p.end])).toEqual([
      ["open", week.start, iso(at("09:30"))],
      ["setup", iso(at("09:30")), iso(at("10:00"))],
      ["event", iso(at("10:00")), iso(at("11:00"))],
      ["turnaround", iso(at("11:00")), iso(at("11:15"))],
      ["block", iso(at("11:15")), iso(at("11:45"))],
      ["open", iso(at("11:45")), week.end],
    ]);
  });

  it("S2: a booking that began before the range is clipped to it, and keeps its full event times", async () => {
    const { reader, get } = arrange();
    reader.hold("orchid", "CONFIRMED", sgtToUtc("2026-11-08", "20:00"), sgtToUtc("2026-11-09", "03:00"));

    const periods = await get();

    expect(periods[0]).toMatchObject({ status: "CONFIRMED", start: week.start, end: iso(sgtToUtc("2026-11-09", "03:00")) });
    expect(periods[0]).toMatchObject({ event_start: iso(sgtToUtc("2026-11-08", "20:00")) });
  });

  it("S5: if old data has two bookings overlapping, the Confirmed one wins the overlap whatever order they come in", async () => {
    const { reader, get } = arrange();
    reader.hold("orchid", "CONFIRMED", at("10:00"), at("12:00"));
    reader.hold("orchid", "TENTATIVELY_HELD", at("11:00"), at("13:00"));

    const periods = await get();

    expect(periods.map((p) => [p.status, p.start, p.end])).toEqual([
      ["AVAILABLE", week.start, iso(at("10:00"))],
      ["CONFIRMED", iso(at("10:00")), iso(at("12:00"))],
      ["TENTATIVELY_HELD", iso(at("12:00")), iso(at("13:00"))],
      ["AVAILABLE", iso(at("13:00")), week.end],
    ]);
  });

  it("S6: nothing that identifies the event, the coordinator or the block's author is returned", async () => {
    const { reader, get } = arrange();
    reader.hold("orchid", "CONFIRMED", at("10:00"), at("12:00"));
    reader.block("orchid", at("14:00"), at("16:00"));

    const text = JSON.stringify(await get());

    expect(text).not.toMatch(/notes|created_by|recorded|event_id|booking_id|coordinator/i);
  });

  it("an adjacent free stretch before and after midnight is one period, so the range has no seams", async () => {
    const { get } = arrange();
    expect(await get()).toEqual([open(week.start, week.end)]);
  });
});
