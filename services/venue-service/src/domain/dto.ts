import {
  dbStatusToApi,
  flagLabel,
  notificationReasonLabel,
  utcToSgt,
  type FlagDto,
  type FlagHistoryDto,
  type FlagUnavailabilityDto,
  type ReplacementRefDto,
  type VenueBookingStatus,
} from "@spm-t5/shared";
import type { BookingRecord, FlagHistoryRecord, FlagRecord } from "./types";

/**
 * SCRUM-104: an open flag as the API shows it. The coordinator's version carries the other booking's period and no event
 * name (36-S5); Venue Staff pass `otherEventName` to get it too (the name is joined at read time, never stored).
 */
export function toFlagDto(f: FlagRecord, staff?: { otherEventName: string | null }): FlagDto {
  // SCRUM-106: a block can span days, so its period is `unavailability` (dates included) and `otherPeriod`, a single day, is null
  const unavailability = f.kind === "venue_unavailable" && f.otherStart && f.otherEnd ? toUnavailabilityDto(f) : undefined;
  return {
    id: f.id,
    kind: f.kind,
    label: flagLabel(f.kind) ?? f.kind,
    createdAt: f.createdAt.toISOString(),
    otherPeriod:
      !unavailability && f.otherStart && f.otherEnd
        ? { date: utcToSgt(f.otherStart).date, startTime: utcToSgt(f.otherStart).time, endTime: utcToSgt(f.otherEnd).time }
        : null,
    ...(unavailability ? { unavailability } : {}),
    ...(staff ? { otherEventName: staff.otherEventName, otherBookingId: f.otherBookingId } : {}),
  };
}

/** SCRUM-107 (107-S3): a flag with its outcome, so the original booking keeps showing why it was flagged and how it ended. */
export function toFlagHistoryDto(f: FlagHistoryRecord): FlagHistoryDto {
  const dto = toFlagDto(f);
  return {
    id: dto.id,
    kind: dto.kind,
    label: dto.label,
    createdAt: dto.createdAt,
    resolvedAt: f.resolvedAt ? f.resolvedAt.toISOString() : null,
    resolvedReason: f.resolvedReason,
    ...(dto.unavailability ? { unavailability: dto.unavailability } : {}),
  };
}

/** SCRUM-107: the booking at the other end of a replacement link. */
export function toReplacementRef(b: BookingRecord, venueName: string): ReplacementRefDto {
  const start = utcToSgt(b.start);
  return {
    id: b.id,
    venueName,
    date: start.date,
    startTime: start.time,
    endTime: utcToSgt(b.end).time,
    status: dbStatusToApi(b.status) ?? b.status,
  };
}

function toUnavailabilityDto(f: FlagRecord): FlagUnavailabilityDto {
  const start = utcToSgt(f.otherStart as Date);
  const end = utcToSgt(f.otherEnd as Date);
  const reason = f.unavailabilityReason ?? "other";
  return { startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time, reason, reasonLabel: notificationReasonLabel(reason) };
}

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
  /** SCRUM-110: the check as it was when the request was made; null for older requests. */
  suitability: "suitable" | "not_suitable" | null;
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
    suitability: b.suitability,
  };
}

/** A booking just requested (SCRUM-32, 60, 59), with SCRUM-98's capacity warning. */
export interface SubmittedBookingDto extends BookingDto {
  exceedsCapacity: boolean;
}

export function toSubmittedBookingDto(s: { booking: BookingRecord; exceedsCapacity: boolean }): SubmittedBookingDto {
  return { ...toBookingDto(s.booking), exceedsCapacity: s.exceedsCapacity };
}

/** A venue booking the coordinator cancelled (SCRUM-102/AC2): who, when and why. */
export interface CancelledBookingDto extends BookingDto {
  cancelledBy: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
}

export function toCancelledBookingDto(b: BookingRecord): CancelledBookingDto {
  return {
    ...toBookingDto(b),
    cancelledBy: b.cancelledBy,
    cancelledAt: b.cancelledAt ? b.cancelledAt.toISOString() : null,
    cancellationReason: b.cancellationReason,
  };
}

/** The outcome of a Venue Staff decision (SCRUM-38, SCRUM-39): the request plus who decided, when and why. */
export interface DecisionDto extends BookingDto {
  decidedBy: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
}

export function toDecisionDto(b: BookingRecord): DecisionDto {
  return {
    ...toBookingDto(b),
    decidedBy: b.reviewedBy,
    decidedAt: b.reviewedAt ? b.reviewedAt.toISOString() : null,
    rejectionReason: b.status === "rejected" ? b.reviewNotes : null,
  };
}

/** A row in the Coordinator's list (SCRUM-33). */
export interface BookingListItem {
  id: string;
  eventId: string;
  eventName: string;
  venueId: string;
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: VenueBookingStatus | undefined;
  /** Only for APPROVED and REJECTED (33-S1). */
  decidedAt: string | null;
  submittedAt: string;
  /** SCRUM-104: the open flags on this booking (buffer conflicts); empty when none. */
  flags: FlagDto[];
}

export function toBookingListItem(b: BookingRecord, venueName: string, flags: FlagDto[] = []): BookingListItem {
  const start = utcToSgt(b.start);
  const status = dbStatusToApi(b.status);
  const decided = (status === "APPROVED" || status === "REJECTED") && b.reviewedAt;
  return {
    id: b.id,
    eventId: b.eventId,
    eventName: b.snapshot.eventName,
    venueId: b.venueId,
    venueName,
    date: start.date,
    startTime: start.time,
    endTime: utcToSgt(b.end).time,
    status,
    decidedAt: decided ? b.reviewedAt!.toISOString() : null,
    submittedAt: b.createdAt.toISOString(),
    flags,
  };
}

/** One step of an amendment chain, shown with its own outcome (33-S5). */
export interface ChainItem extends BookingListItem {
  rejectionReason: string | null;
}

/** One booking in the list of an event's bookings (SCRUM-98/AC5), with its own numbers and the capacity warning. */
export interface EventBookingItem extends ChainItem {
  /** SCRUM-102: only for a CANCELLED one; null for every other status. */
  cancellationReason: string | null;
  expectedAttendance: number | null;
  venueRequirements: string | null;
  exceedsCapacity: boolean;
  /** SCRUM-113/AC1: sent back to Pending for review after an important event change, and not decided since. */
  sentBackForReview: boolean;
  /** SCRUM-107: the booking that replaces this one (pending or approved), and the one this replaces; null when there is none. */
  replacedBy: ReplacementRefDto | null;
  replaces: ReplacementRefDto | null;
}

export interface BookingDetail extends BookingListItem {
  expectedAttendance: number | null;
  venueRequirements: string | null;
  accessibilityNeeds: string | null;
  submittedBy: string | null;
  rejectionReason: string | null;
  suggestion: { venueId: string; venueName: string; date: string; startTime: string; endTime: string } | null;
  amendsRequestId: string | null;
  /** The amendment chain in order, root first, including this request. */
  chain: ChainItem[];
  /** SCRUM-107: the replacement waiting for a decision or approved, and the original this one replaces. */
  replacedBy: ReplacementRefDto | null;
  replaces: ReplacementRefDto | null;
  /** SCRUM-107 (107-S3): every flag this booking ever had and how each ended. */
  flagHistory: FlagHistoryDto[];
}

export const rejectionReasonOf = (b: BookingRecord) => (b.status === "rejected" ? b.reviewNotes : null);
