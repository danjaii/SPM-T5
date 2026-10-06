import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { supabasePorts } from "../../src/ports";
import { SupabaseEquipmentReader } from "../../src/readers/equipmentReader";
import { SupabaseReservationReader } from "../../src/readers/reservationReader";
import { SupabaseRoleReader } from "../../src/readers/roleReader";
import { createSupabaseDeps, type SupabaseDeps } from "../../src/supabase";

// ----------------------------------------------------------------------------
// Pretend Supabase: records every query it is asked (table, filters, order) and gives back a set reply.
// The other tests use fake readers; these check the real readers ask Supabase the right questions.
// ----------------------------------------------------------------------------

type Reply = { data: unknown; error: { message: string } | null };

function stubDb(reply: Reply) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "lt", "gt", "order"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return chain;
    };
  }
  chain.maybeSingle = async () => reply;
  chain.then = (resolve: (r: Reply) => unknown) => resolve(reply);
  const db = {
    from: (table: string) => {
      calls.push(["from", table]);
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

// end of pretend Supabase

// ----------------------------------------------------------------------------
// SCRUM-18 Supabase readers
// ----------------------------------------------------------------------------
describe("SCRUM-18 Supabase readers", () => {
  // The equipment catalogue: read from the equipment table, A to Z, turned into the shape the service uses.
  it("SupabaseEquipmentReader lists the catalogue in name order and maps each row", async () => {
    const { db, calls } = stubDb({
      data: [{ id: "e1", name: "Projector Unit", total_quantity: 10, operational_status: "available" }],
      error: null,
    });

    expect(await new SupabaseEquipmentReader(db).list()).toEqual([
      { id: "e1", name: "Projector Unit", totalQuantity: 10, operationalStatus: "available" },
    ]);
    expect(calls).toContainEqual(["from", "equipment"]);
    expect(calls).toContainEqual(["order", "name", { ascending: true }]);
  });

  it("SupabaseEquipmentReader throws when Supabase fails", async () => {
    const { db } = stubDb({ data: null, error: { message: "down" } });

    await expect(new SupabaseEquipmentReader(db).list()).rejects.toThrow(/Reading equipment failed/);
  });
  // end of equipment reader

  // Reservations: only this equipment's, and only those that overlap the period being checked.
  it("SupabaseReservationReader asks for this equipment's reservations that overlap the period", async () => {
    const start = new Date("2026-10-15T01:00:00Z");
    const end = new Date("2026-10-15T09:00:00Z");
    const { db, calls } = stubDb({
      data: [
        {
          equipment_id: "e1",
          start_datetime: "2026-10-15T02:00:00+00:00",
          end_datetime: "2026-10-15T05:00:00+00:00",
          status: "approved",
          quantity_requested: 4,
          quantity_reserved: null,
        },
      ],
      error: null,
    });

    expect(await new SupabaseReservationReader(db).overlapping("e1", start, end)).toEqual([
      {
        equipmentId: "e1",
        start: new Date("2026-10-15T02:00:00Z"),
        end: new Date("2026-10-15T05:00:00Z"),
        status: "approved",
        quantityRequested: 4,
        quantityReserved: null,
      },
    ]);
    expect(calls).toContainEqual(["from", "equipment_reservations"]);
    expect(calls).toContainEqual(["eq", "equipment_id", "e1"]);
    // Overlap: the reservation starts before the period ends, and ends after the period starts.
    expect(calls).toContainEqual(["lt", "start_datetime", end.toISOString()]);
    expect(calls).toContainEqual(["gt", "end_datetime", start.toISOString()]);
  });

  it("SupabaseReservationReader throws when Supabase fails", async () => {
    const { db } = stubDb({ data: null, error: { message: "down" } });

    await expect(
      new SupabaseReservationReader(db).overlapping("e1", new Date(), new Date()),
    ).rejects.toThrow(/Reading equipment reservations failed/);
  });
  // end of reservation reader

  // Roles: a real role comes back as it is; anything else counts as no role.
  it("SupabaseRoleReader returns a real role, and undefined for anything else", async () => {
    const role = (data: unknown) => new SupabaseRoleReader(stubDb({ data, error: null }).db).roleOf("u");

    expect(await role({ role: "technical_support_staff" })).toBe("technical_support_staff");
    expect(await role({ role: "wizard" })).toBeUndefined();
    expect(await role(null)).toBeUndefined();
  });
  // end of role reader

  // Wiring: every reader queries as the signed-in user (so Supabase's access rules apply).
  it("supabasePorts builds every reader on the caller's own connection", () => {
    const tokens: string[] = [];
    const deps = {
      anon: {} as SupabaseClient,
      forUser: (token: string) => {
        tokens.push(token);
        return stubDb({ data: null, error: null }).db;
      },
    } satisfies SupabaseDeps;

    const ports = supabasePorts(deps)("tok-1");

    expect(tokens).toEqual(["tok-1"]);
    expect(ports.equipment).toBeInstanceOf(SupabaseEquipmentReader);
    expect(ports.reservations).toBeInstanceOf(SupabaseReservationReader);
    expect(ports.roles).toBeInstanceOf(SupabaseRoleReader);
  });

  it("createSupabaseDeps refuses to start without the Supabase settings, and connects when they are set", () => {
    expect(() => createSupabaseDeps({})).toThrow(/SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set/);

    const deps = createSupabaseDeps({ SUPABASE_URL: "http://localhost:54321", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" });
    expect(deps.anon).toBeDefined();
    expect(deps.forUser("tok")).toBeDefined();
  });
  // end of wiring
});
// end of SCRUM-18 Supabase readers
