import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { sgtToUtc } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import { BookingError } from "../../src/domain/errors";
import { SlotConflictRule } from "../../src/services/slotConflictRule";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeUserReader } from "../support/fakeUserReader";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

// SCRUM-103: the customer's worked example. Orchid Hall has setup 30 and turnaround 45; "Summit A" holds it on
// 2026-11-14 from 10:00 to 12:00, so it really occupies 09:30 to 12:45.
const NOW = new Date("2026-10-01T00:00:00.000Z");
const ORCHID = "venue-orchid";
const LOTUS = "venue-lotus";
const DAY = "2026-11-14";
const MESSAGE_ORCHID = "Orchid Hall is occupied from 09:30 to 12:45, including setup and turnaround";

const at = (time: string) => sgtToUtc(DAY, time);

const deps = {
  anon: { auth: { getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }) } },
  forUser: () => {
    throw new Error("ports are faked");
  },
} as unknown as SupabaseDeps;

function setup(holderStatus: "approved" | "requested" = "approved") {
  const bookings = new FakeBookingRepository(() => NOW);
  bookings.setVenue(ORCHID, { name: "Orchid Hall", setupMinutes: 30, turnaroundMinutes: 45 });
  bookings.setVenue(LOTUS, { name: "Lotus Room", setupMinutes: 0, turnaroundMinutes: 0 });
  bookings.seed({ eventId: "summit-a", venueId: ORCHID, start: at("10:00"), end: at("12:00"), status: holderStatus, requestedBy: "coordinator-a" });
  bookings.seed({ eventId: "lotus-a", venueId: LOTUS, start: at("09:00"), end: at("12:00"), status: "approved", requestedBy: "coordinator-a" });
  const events = new FakeEventReader([anEvent({ id: "summit-b", name: "Summit B", assignedCoordinatorId: "coordinator-1" })]);
  const venues = new FakeVenueReader([
    aVenue({ id: ORCHID, name: "Orchid Hall", setupMinutes: 30, turnaroundMinutes: 45 }),
    aVenue({ id: LOTUS, name: "Lotus Room" }),
  ]);
  const roles = new FakeRoleReader({ "coordinator-1": "event_coordinator" });
  const app = createApp(deps, { now: () => NOW, ports: () => ({ bookings, events, venues, roles, users: new FakeUserReader() }) });
  const submit = (venueId: string, startTime: string, endTime: string) =>
    request(app).post("/venue-bookings").set("Cookie", "cs_session=tok-coordinator-1").send({ eventId: "summit-b", venueId, date: DAY, startTime, endTime });
  return { bookings, submit };
}

describe("SCRUM-103/AC1 the customer's worked example is refused with the occupied period (103-S1)", () => {
  it("103-S1: 12:30-14:00 is refused with the exact message and nothing is created", async () => {
    const { submit, bookings } = setup();

    const res = await submit(ORCHID, "12:30", "14:00");

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "SLOT_CONFLICT", error: MESSAGE_ORCHID });
    expect(bookings.rows).toHaveLength(2);
  });

  it("103-S1: the refusal names no event, coordinator or request (36-S5)", async () => {
    const { submit } = setup();
    const body = JSON.stringify((await submit(ORCHID, "12:30", "14:00")).body);
    for (const secret of ["Summit A", "summit-a", "coordinator-a", "booking-"]) expect(body).not.toContain(secret);
  });

  it("103-S1: the request is refused even though the two events themselves do not overlap", async () => {
    const { bookings } = setup();
    // 12:30 is after Summit A's 12:00 end, so the old, unpadded rule would have allowed it.
    expect(await bookings.hasHold(ORCHID, at("12:30"), at("14:00"))).toBe(true);
  });
});

describe("SCRUM-103/AC2 boundary, where the padded periods only touch (103-S2)", () => {
  it("103-S2: 13:15-15:00 (occupies 12:45-15:45) is created Pending", async () => {
    const { submit, bookings } = setup();

    const res = await submit(ORCHID, "13:15", "15:00");

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
    expect(bookings.rows).toHaveLength(3);
  });

  it("103-S2: one minute earlier (13:14) is refused", async () => {
    const { submit } = setup();
    expect((await submit(ORCHID, "13:14", "15:00")).status).toBe(409);
  });
});

describe("SCRUM-103/AC3 my turnaround runs into an existing booking's setup (103-S3)", () => {
  it("103-S3: 08:00-08:50 (occupies until 09:35) is refused", async () => {
    const { submit } = setup();

    const res = await submit(ORCHID, "08:00", "08:50");

    expect(res.status).toBe(409);
    expect(res.body.error).toBe(MESSAGE_ORCHID);
  });

  it("103-S3: 08:00-08:45 (occupies until 09:30) only touches and is created", async () => {
    const { submit } = setup();
    expect((await submit(ORCHID, "08:00", "08:45")).status).toBe(201);
  });
});

describe("SCRUM-103/AC4 pending requests are checked the same way (103-S4)", () => {
  it("103-S4: a Pending holder refuses 12:30-14:00", async () => {
    const { submit } = setup("requested");

    const res = await submit(ORCHID, "12:30", "14:00");

    expect(res.status).toBe(409);
    expect(res.body.error).toBe(MESSAGE_ORCHID);
  });

  it.each(["rejected", "withdrawn"])("103-S4: a %s holder does not block", async (status) => {
    const { submit, bookings } = setup();
    bookings.rows.find((r) => r.eventId === "summit-a")!.status = status;
    expect((await submit(ORCHID, "12:30", "14:00")).status).toBe(201);
  });
});

describe("SCRUM-103/AC6 zero times keep the existing behaviour (103-S6)", () => {
  it("103-S6: Lotus Room 12:00 straight after a booking ending 12:00 is created Pending", async () => {
    const { submit } = setup();
    const res = await submit(LOTUS, "12:00", "14:00");
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
  });

  it("103-S6: an overlap at a zero-time venue is refused without the setup suffix", async () => {
    const { submit } = setup();
    const res = await submit(LOTUS, "11:00", "13:00");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Lotus Room is occupied from 09:00 to 12:00");
  });
});

describe("SCRUM-103/AC1 SlotConflictRule (103-S1)", () => {
  it("103-S1: findConflict returns the holder's occupied period, or null when the slot is free", async () => {
    const { bookings } = setup();
    const rule = new SlotConflictRule(bookings);

    expect(await rule.findConflict(ORCHID, at("12:30"), at("14:00"))).toMatchObject({
      venueName: "Orchid Hall",
      eventStart: at("10:00"),
      eventEnd: at("12:00"),
      occupiedStart: at("09:30"),
      occupiedEnd: at("12:45"),
      status: "APPROVED",
    });
    expect(await rule.findConflict(ORCHID, at("13:15"), at("15:00"))).toBeNull();
  });

  it("103-S1: check throws the specific SLOT_CONFLICT message", async () => {
    const { bookings } = setup();
    const error = await new SlotConflictRule(bookings).check(ORCHID, at("12:30"), at("14:00")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BookingError);
    expect(error).toMatchObject({ code: "SLOT_CONFLICT", httpStatus: 409, message: MESSAGE_ORCHID });
  });

  it("103-S1: findConflict reports the earliest holder when several conflict", async () => {
    const { bookings } = setup();
    bookings.seed({ eventId: "summit-c", venueId: ORCHID, start: at("14:00"), end: at("15:00"), status: "requested" });
    const conflict = await new SlotConflictRule(bookings).findConflict(ORCHID, at("11:00"), at("16:00"));
    expect(conflict?.eventStart).toEqual(at("10:00"));
  });
});

describe("SCRUM-103/AC1 losing the race still gets the specific message (103-S7)", () => {
  it("103-S7: the pre-check passes, the insert is refused, and the message is rebuilt", async () => {
    const { bookings, submit } = setup();
    // The holder appears after the friendly pre-check has run: simulate by letting the first hasHold/findConflict
    // lookup see nothing, then the insert hit the database guard.
    const real = bookings.slotConflicts.bind(bookings);
    const lookup = vi.spyOn(bookings, "slotConflicts").mockResolvedValueOnce([]).mockImplementation(real);

    const res = await submit(ORCHID, "12:30", "14:00");

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "SLOT_CONFLICT", error: MESSAGE_ORCHID });
  });
});
