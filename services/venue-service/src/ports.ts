import type { SupabaseDeps } from "./supabase";
import type { EventReader } from "./readers/eventReader";
import { SupabaseEventReader } from "./readers/supabaseEventReader";
import { SupabaseRoleReader, type RoleReader } from "./readers/roleReader";
import { SupabaseVenueReader, type VenueReader } from "./readers/venueReader";
import type { BookingRepository } from "./repositories/bookingRepository";
import { SupabaseBookingRepository } from "./repositories/supabaseBookingRepository";

/** Everything the routes read or write, built per request for the caller's token. */
export interface Ports {
  bookings: BookingRepository;
  events: EventReader;
  venues: VenueReader;
  roles: RoleReader;
}

export type PortsFactory = (accessToken: string) => Ports;

/** The real thing: every query runs as the caller, so RLS applies. Tests pass a factory of fakes instead. */
export function supabasePorts(deps: SupabaseDeps): PortsFactory {
  return (token) => {
    const db = deps.forUser(token);
    return {
      bookings: new SupabaseBookingRepository(db),
      events: new SupabaseEventReader(db),
      venues: new SupabaseVenueReader(db),
      roles: new SupabaseRoleReader(db),
    };
  };
}
