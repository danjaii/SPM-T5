import { SupabaseEquipmentReader, type EquipmentReader } from "./readers/equipmentReader";
import { SupabaseReservationReader, type ReservationReader } from "./readers/reservationReader";
import { SupabaseRoleReader, type RoleReader } from "./readers/roleReader";
import type { SupabaseDeps } from "./supabase";

/** Everything the routes read, built per request for the caller's token. */
export interface Ports {
  equipment: EquipmentReader;
  reservations: ReservationReader;
  roles: RoleReader;
}

export type PortsFactory = (accessToken: string) => Ports;

/** The real thing: every query runs as the caller, so RLS applies. Tests pass a factory of fakes instead. */
export function supabasePorts(deps: SupabaseDeps): PortsFactory {
  return (token) => {
    const db = deps.forUser(token);
    return {
      equipment: new SupabaseEquipmentReader(db),
      reservations: new SupabaseReservationReader(db),
      roles: new SupabaseRoleReader(db),
    };
  };
}
