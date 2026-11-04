import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { bookingError, notFound } from "../../src/domain/errors";
import type { HoldWarningWriter } from "../../src/readers/holdWarningWriter";
import { SupabaseHoldWarningWriter, translateWarningError } from "../../src/readers/holdWarningWriter";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

/** SCRUM-108/AC1: the event's coordinator sets the warning time of a hold. */
const NOW = new Date("2026-11-01T04:00:00.000Z");
const SLOT = { start: new Date("2030-11-14T01:00:00Z"), end: new Date("2030-11-14T09:00:00Z") };
const deps = { anon: { auth: { getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }) } }, forUser: () => { throw new Error("ports are faked"); } } as unknown as SupabaseDeps;

class FakeWarningWriter implements HoldWarningWriter {
  readonly calls: { id: string; minutes: number }[] = [];
  failWith?: Error;
  async setWarning(id: string, minutes: number) {
    if (this.failWith) throw this.failWith;
    this.calls.push({ id, minutes });
    return { id, holdWarningMinutes: minutes };
  }
}

function setup() {
  const bookings = new FakeBookingRepository(() => NOW);
  const roles = new FakeRoleReader({ "coordinator-1": "event_coordinator", "staff-1": "venue_staff", "organiser-1": "event_organiser" });
  const writer = new FakeWarningWriter();
  const app = createApp(deps, { now: () => NOW, ports: () => ({ bookings, events: new FakeEventReader([anEvent()]), venues: new FakeVenueReader([aVenue()]), roles }), holdWarning: () => writer });
  const put = (id: string, body: unknown, user = "coordinator-1") => request(app).put(`/venue-bookings/${id}/hold-warning`).set("Cookie", `cs_session=tok-${user}`).send(body as object);
  const pending = (over: Record<string, unknown> = {}) => bookings.seed({ eventId: "event-1", venueId: "venue-1", ...SLOT, ...over });
  return { writer, put, pending };
}

describe("SCRUM-108/AC1 PUT /venue-bookings/:id/hold-warning", () => {
  it("SCRUM-108/AC1 saves the minutes against that hold and answers with them", async () => {
    const { put, pending, writer } = setup();
    const row = pending();
    const res = await put(row.id, { minutes: 120 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: row.id, status: "PENDING", holdWarningMinutes: 120 });
    expect(writer.calls).toEqual([{ id: row.id, minutes: 120 }]);
  });

  it.each([{}, { minutes: 0 }, { minutes: 1.5 }, { minutes: 43201 }, { minutes: "60" }])("SCRUM-108/AC1 answers 422 on `minutes` and saves nothing for %j", async (body) => {
    const { put, pending, writer } = setup();
    const res = await put(pending().id, body);
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fieldErrors)).toEqual(["minutes"]);
    expect(writer.calls).toEqual([]);
  });

  it.each(["staff-1", "organiser-1"])("SCRUM-108/AC7 answers 403 to %s: only an Event Coordinator sets it", async (user) => {
    const { put, pending, writer } = setup();
    expect((await put(pending().id, { minutes: 60 }, user)).status).toBe(403);
    expect(writer.calls).toEqual([]);
  });

  it("SCRUM-108/AC1 answers 404 for an unknown request and 409 NOT_PENDING once it is decided", async () => {
    const { put, pending } = setup();
    expect((await put("missing", { minutes: 60 })).status).toBe(404);
    const res = await put(pending({ status: "approved" }).id, { minutes: 60 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_PENDING");
  });

  it("SCRUM-108/AC7 passes on the database's refusal (not this event's coordinator is a 404), saving nothing", async () => {
    const { put, pending, writer } = setup();
    writer.failWith = notFound("Venue booking request not found.");
    expect((await put(pending().id, { minutes: 60 })).status).toBe(404);
  });
});

describe("SCRUM-108/AC1 the database writer", () => {
  it("SCRUM-108/AC1 calls set_hold_warning as the caller and reads the saved minutes", async () => {
    const calls: unknown[] = [];
    const db = { rpc: async (fn: string, args: unknown) => { calls.push([fn, args]); return { data: { id: "b1", hold_warning_minutes: 90 }, error: null }; } };
    const saved = await new SupabaseHoldWarningWriter(db as never).setWarning("b1", 90);
    expect(calls).toEqual([["set_hold_warning", { p_booking_id: "b1", p_minutes: 90 }]]);
    expect(saved).toEqual({ id: "b1", holdWarningMinutes: 90 });
  });

  it.each([["HW001", 422], ["HW002", 409], ["42501", 403], ["P0002", 404]])("SCRUM-108/AC1 maps %s to HTTP %i", (code, status) => {
    expect((translateWarningError({ code, message: "m" }) as { httpStatus: number }).httpStatus).toBe(status);
  });

  it("SCRUM-108/AC1 leaves any other database error an ordinary error", () => {
    expect(translateWarningError({ code: "XX000", message: "boom" })).not.toHaveProperty("httpStatus");
    expect(bookingError("NOT_PENDING")).toBeDefined();
  });
});
