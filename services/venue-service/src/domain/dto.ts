import { dbStatusToApi, utcToSgt, type VenueBookingStatus } from "@spm-t5/shared";
import type { BookingRecord } from "./types";

/** A venue booking request as the API shows it: Singapore date and times, API status (DR3, DR4). */
export interface BookingDto {
  id: string;
  eventId: string;
  venueId: string;
  status: VenueBookingStatus | undefined;
  date: string;
  startTime: string;
  endTime: string;
  eventName: string;
  expectedAttendance: number | null;
  venueRequirements: string | null;
  accessibilityNeeds: string | null;
  submittedBy: string | null;
  submittedAt: string;
}

export function toBookingDto(b: BookingRecord): BookingDto {
  const start = utcToSgt(b.start);
  return {
    id: b.id,
    eventId: b.eventId,
    venueId: b.venueId,
    status: dbStatusToApi(b.status),
    date: start.date,
    startTime: start.time,
    endTime: utcToSgt(b.end).time,
    eventName: b.snapshot.eventName,
    expectedAttendance: b.snapshot.expectedAttendance,
    venueRequirements: b.snapshot.venueRequirements,
    accessibilityNeeds: b.snapshot.accessibilityNeeds,
    submittedBy: b.requestedBy,
    submittedAt: b.createdAt.toISOString(),
  };
}
