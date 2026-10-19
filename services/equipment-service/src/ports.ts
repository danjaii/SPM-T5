import { SupabaseEquipmentReader, type EquipmentReader } from "./readers/equipmentReader";
import { SupabaseEquipmentRequestReader, type EquipmentRequestReader } from "./readers/equipmentRequestReader";
import { SupabaseEventReader, type EventReader } from "./readers/eventReader";
import { SupabaseReservationReader, type ReservationReader } from "./readers/reservationReader";
import { SupabaseRoleReader, type RoleReader } from "./readers/roleReader";
import { SupabaseVenueBookingReader, type VenueBookingReader } from "./readers/venueBookingReader";
import type { SupabaseDeps } from "./supabase";
import {
  SupabaseEquipmentRequestReviewer,
  SupabaseEquipmentRequestWriter,
  type EquipmentRequestReviewer,
  type EquipmentRequestWriter,
} from "./writers/equipmentRequestWriter";
import { SupabaseReservationWriter, type ReservationWriter } from "./writers/reservationWriter";

/** Everything the routes read and write, built per request for the caller's token. */
export interface Ports {
  /** SCRUM-19: the events equipment is reserved for. */
  events: EventReader;
  equipment: EquipmentReader;
  reservations: ReservationReader;
  roles: RoleReader;
  /** SCRUM-19: saves reservations. */
  writer: ReservationWriter;
  /** SCRUM-86: the event's venue bookings, for the request form's venue list. */
  venueBookings: VenueBookingReader;
  /** SCRUM-86: an event's equipment requests. */
  requests: EquipmentRequestReader;
  /** SCRUM-86: saves equipment requests. */
  requestWriter: EquipmentRequestWriter;
  /** SCRUM-87: changes a request's status. */
  reviewer: EquipmentRequestReviewer;
}

export type PortsFactory = (accessToken: string) => Ports;

/** The real thing: every query runs as the caller, so RLS applies. Tests pass a factory of fakes instead. */
export function supabasePorts(deps: SupabaseDeps): PortsFactory {
  return (token) => {
    const db = deps.forUser(token);
    return {
      events: new SupabaseEventReader(db),
      equipment: new SupabaseEquipmentReader(db),
      reservations: new SupabaseReservationReader(db),
      roles: new SupabaseRoleReader(db),
      writer: new SupabaseReservationWriter(db),
      venueBookings: new SupabaseVenueBookingReader(db),
      requests: new SupabaseEquipmentRequestReader(db),
      requestWriter: new SupabaseEquipmentRequestWriter(db),
      reviewer: new SupabaseEquipmentRequestReviewer(db),
    };
  };
}
