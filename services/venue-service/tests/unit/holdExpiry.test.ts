import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { bookingError, validationFailed } from "../../src/domain/errors";
import type { HoldExpiryWriter } from "../../src/readers/holdExpiryWriter";
import { SupabaseHoldExpiryWriter } from "../../src/readers/holdExpiryWriter";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

/** SCRUM-97: Venue Staff set a hold's expiry. The clock is injected, so "now" is whatever the test says. */
const NOW = new Date("2026-11-01T04:00:00.000Z");
const SLOT = { start: new Date("2030-11-14T01:00:00Z"), end: new Date("2030-11-14T09:00:00Z") };
const IN_A_DAY = "2026-11-02T04:00:00.000Z";

const deps = {
  anon: { auth: { getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }) } },
  forUser: () => {
    throw new Error("ports are faked");
  },
} as unknown as SupabaseDeps;

class FakeHoldWriter implements HoldExpiryWriter {
  readonly calls: { id: string; at: Date }[] = [];
  failWith?: Error;
  async set(id: string, at: Date) {
    if (this.failWith) throw this.failWith;
    this.calls.push({ id, at });
    return { id, holdExpiresAt: at };
  }
}

function setup() {
  const bookings = new FakeBookingRepository(() => NOW);
  const events = new FakeEventReader([anEvent()]);
  const venues = new FakeVenueReader([aVenue()]);
  const roles = new FakeRoleReader({ "coordinator-1": "event_coordinator", "staff-1": "venue_staff", "organiser-1": "event_organiser" });
  const writer = new FakeHoldWriter();
  const app = createApp(deps, { now: () => NOW, ports: () => ({ bookings, events, venues, roles }), holdExpiry: () => writer });
  const put = (id: string, body: unknown, user = "staff-1") =>
    request(app).put(`/venue-bookings/${id}/hold-expiry`).set("Cookie", `cs_session=tok-${user}`).send(body as object);
  const pending = (over: Record<string, unknown> = {}) => bookings.seed({ eventId: "event-1", venueId: "venue-1", ...SLOT, ...over });
  return { writer, put, pending };
}

describe("SCRUM-97/AC1 Venue Staff set a hold's expiry (PUT /venue-bookings/:id/hold-expiry)", () => {
  it("saves a future expiry and answers with the hold", async () => {
    const { put, pending, writer } = setup();
    const row = pending();
    const res = await put(row.id, { expiresAt: IN_A_DAY });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: row.id, status: "PENDING", holdExpiresAt: IN_A_DAY });
    expect(writer.calls).toEqual([{ id: row.id, at: new Date(IN_A_DAY) }]);
  });

  it.each([
    ["is missing", {}],
    ["is in the past", { expiresAt: "2026-10-31T04:00:00.000Z" }],
    ["is after the event starts", { expiresAt: "2030-11-14T01:00:01.000Z" }],
  ])("answers 422 with a field error and saves nothing when the expiry %s", async (_label, body) => {
    const { put, pending, writer } = setup();
    const res = await put(pending().id, body);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(res.body.fieldErrors)).toEqual(["expiresAt"]);
    expect(writer.calls).toEqual([]);
  });

  it.each(["coordinator-1", "organiser-1"])("answers 403 to %s, who is not Venue Staff", async (user) => {
    const { put, pending, writer } = setup();
    expect((await put(pending().id, { expiresAt: IN_A_DAY }, user)).status).toBe(403);
    expect(writer.calls).toEqual([]);
  });

  it("answers 404 for an unknown request", async () => {
    expect((await setup().put("nope", { expiresAt: IN_A_DAY })).status).toBe(404);
  });

  it.each(["approved", "rejected", "withdrawn"])("answers 409 NOT_PENDING for a %s request", async (status) => {
    const { put, pending, writer } = setup();
    const res = await put(pending({ status }).id, { expiresAt: IN_A_DAY });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_PENDING");
    expect(writer.calls).toEqual([]);
  });

  it("answers the database's refusal when the clock and the database disagree (HE001 -> 422, HE002 -> 409)", async () => {
    const a = setup();
    a.writer.failWith = validationFailed({ expiresAt: "An expiry date and time in the future is required." });
    expect((await a.put(a.pending().id, { expiresAt: IN_A_DAY })).status).toBe(422);
    const b = setup();
    b.writer.failWith = bookingError("NOT_PENDING");
    expect((await b.put(b.pending().id, { expiresAt: IN_A_DAY })).status).toBe(409);
  });
});

describe("SCRUM-97/AC1 SupabaseHoldExpiryWriter calls set_hold_expiry and translates its errors", () => {
  const dbWith = (result: { data?: unknown; error?: { code: string; message: string } }) => {
    const calls: unknown[] = [];
    return { calls, db: { rpc: async (fn: string, args: unknown) => (calls.push({ fn, args }), { data: null, error: null, ...result }) } as never };
  };

  it("sends the booking and the time, and returns the saved expiry", async () => {
    const { db, calls } = dbWith({ data: { id: "b1", hold_expires_at: IN_A_DAY } });
    const saved = await new SupabaseHoldExpiryWriter(db).set("b1", new Date(IN_A_DAY));
    expect(calls).toEqual([{ fn: "set_hold_expiry", args: { p_booking_id: "b1", p_expires_at: IN_A_DAY } }]);
    expect(saved).toEqual({ id: "b1", holdExpiresAt: new Date(IN_A_DAY) });
  });

  it.each([
    ["HE001", 422, "VALIDATION_FAILED"],
    ["HE002", 409, "NOT_PENDING"],
    ["42501", 403, "FORBIDDEN"],
    ["P0002", 404, "NOT_FOUND"],
  ])("maps %s to %i %s", async (code, status, appCode) => {
    const { db } = dbWith({ error: { code, message: "x" } });
    await expect(new SupabaseHoldExpiryWriter(db).set("b1", new Date(IN_A_DAY))).rejects.toMatchObject({ httpStatus: status, code: appCode });
  });

  it("lets an unexpected database error through as an ordinary error", async () => {
    const { db } = dbWith({ error: { code: "XX000", message: "boom" } });
    await expect(new SupabaseHoldExpiryWriter(db).set("b1", new Date(IN_A_DAY))).rejects.toThrow("boom");
  });
});
