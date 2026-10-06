import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SupabaseReservationWriter } from "../../src/writers/reservationWriter";

// ----------------------------------------------------------------------------
// Pretend Supabase for the writer: records the database function it is asked to call (name and values) and
// gives back a set reply. The real function (migration 12) is tested against a real database in CI.
// ----------------------------------------------------------------------------

type Reply = { data: unknown; error: { message: string } | null };

function stubDb(reply: Reply) {
  const calls: Array<{ name: string; params: unknown }> = [];
  const db = {
    rpc: async (name: string, params: unknown) => {
      calls.push({ name, params });
      return reply;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

// An ordinary reservation to save: 4 units, 15 Oct 2026, 09:00-17:00 Singapore time (01:00-09:00 UTC).
const reservation = {
  eventId: "evt-devops",
  equipmentId: "eq-projector",
  quantity: 4,
  start: new Date("2026-10-15T01:00:00Z"),
  end: new Date("2026-10-15T09:00:00Z"),
  reservedBy: "tech-1",
};

// end of pretend Supabase

// ----------------------------------------------------------------------------
// SCRUM-19 Supabase writer
// ----------------------------------------------------------------------------
describe("SCRUM-19 Supabase writer", () => {
  // AC1: the reservation is saved by the database function reserve_equipment, which checks and saves in one step.
  it("SupabaseReservationWriter asks the database function to reserve, and reports the new reservation", async () => {
    // The function answers: reserved, as reservation "res-9", with 6 still free.
    const { db, calls } = stubDb({ data: [{ ok: true, reservation_id: "res-9", available: 6 }], error: null });
    // this test is to pretend to be the supabase and receive the request and answer back the request 
    const outcome = await new SupabaseReservationWriter(db).reserve(reservation);

    expect(calls).toEqual([
      {
        name: "reserve_equipment",
        params: {
          p_event_id: "evt-devops",
          p_equipment_id: "eq-projector",
          p_quantity: 4,
          p_start: "2026-10-15T01:00:00.000Z",
          p_end: "2026-10-15T09:00:00.000Z",
        },
      },
    ]);
    expect(outcome).toEqual({ ok: true, id: "res-9", availableAfter: 6 });
  });

  // AC4: not enough free. The function answers ok = false with how many are free, and saved nothing.
  it("SupabaseReservationWriter reports a refusal, with how many are free", async () => {
    const { db } = stubDb({ data: [{ ok: false, reservation_id: null, available: 3 }], error: null });

    expect(await new SupabaseReservationWriter(db).reserve(reservation)).toEqual({ ok: false, available: 3 });
  });

  // If the database itself fails (for example the function refuses the caller's role), the writer throws, so the
  // user gets the plain "Something went wrong." instead of a reservation that looks like it worked.
  it("SupabaseReservationWriter throws when Supabase fails", async () => {
    // if supabase returns an error (here the message "boom"), the writer should throw an error instead of carrying on
    const { db } = stubDb({ data: null, error: { message: "boom" } });

    await expect(new SupabaseReservationWriter(db).reserve(reservation)).rejects.toThrow("Reserving equipment failed: boom");
  });
});
// end of SCRUM-19 Supabase writer
