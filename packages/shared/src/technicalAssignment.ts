import { sgtToUtc } from "./venueBooking";

// SCRUM-20 (docs/specs/technical-assignment-notifications.md): on-site technical support assignments. The assign form
// (apps/web) and equipment-service check them with the same rules.

export const TECHNICAL_ASSIGNMENT_NOTE_MAX = 500;
export const TECHNICAL_ASSIGNMENT_REASON_MAX = 500;

export const TECHNICAL_ASSIGNMENT_MESSAGES = {
  staffMissing: "Choose a technical support staff member.",
  venueBookingMissing: "Choose one of the event's approved venue bookings.",
  dateMissing: "Enter a date.",
  timeMissing: "Enter a time.",
  endBeforeStart: "The end must be after the start.",
  noteTooLong: `Keep the note to ${TECHNICAL_ASSIGNMENT_NOTE_MAX} characters or fewer.`,
  reasonMissing: "Give a reason for cancelling.",
  reasonTooLong: `Keep the reason to ${TECHNICAL_ASSIGNMENT_REASON_MAX} characters or fewer.`,
} as const;

/** The assign or change form's fields; dates and times are Singapore time. */
export type TechnicalAssignmentBody = {
  staffId?: string;
  venueBookingId?: string;
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  note?: string;
};

export type TechnicalAssignmentInput = {
  /** Only when assigning; a change keeps the staff member. */
  staffId?: string;
  venueBookingId: string;
  /** UTC ISO instants. */
  start: string;
  end: string;
  note: string | null;
};

export type ParsedTechnicalAssignment =
  | { ok: true; data: TechnicalAssignmentInput }
  | { ok: false; fieldErrors: Partial<Record<keyof TechnicalAssignmentBody, string>> };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** AC1, AC2: the form's fields checked together, every problem at once. `requireStaff` is true when assigning. */
export function parseTechnicalAssignmentInput(body: unknown, { requireStaff }: { requireStaff: boolean }): ParsedTechnicalAssignment {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const errors: Partial<Record<keyof TechnicalAssignmentBody, string>> = {};

  const staffId = text(input.staffId);
  if (requireStaff && !staffId) errors.staffId = TECHNICAL_ASSIGNMENT_MESSAGES.staffMissing;
  const venueBookingId = text(input.venueBookingId);
  if (!venueBookingId) errors.venueBookingId = TECHNICAL_ASSIGNMENT_MESSAGES.venueBookingMissing;

  const startDate = text(input.startDate);
  const startTime = text(input.startTime);
  const endDate = text(input.endDate);
  const endTime = text(input.endTime);
  if (!DATE.test(startDate)) errors.startDate = TECHNICAL_ASSIGNMENT_MESSAGES.dateMissing;
  if (!TIME.test(startTime)) errors.startTime = TECHNICAL_ASSIGNMENT_MESSAGES.timeMissing;
  if (!DATE.test(endDate)) errors.endDate = TECHNICAL_ASSIGNMENT_MESSAGES.dateMissing;
  if (!TIME.test(endTime)) errors.endTime = TECHNICAL_ASSIGNMENT_MESSAGES.timeMissing;

  const note = text(input.note);
  if (note.length > TECHNICAL_ASSIGNMENT_NOTE_MAX) errors.note = TECHNICAL_ASSIGNMENT_MESSAGES.noteTooLong;

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };

  const start = sgtToUtc(startDate, startTime);
  const end = sgtToUtc(endDate, endTime);
  if (end.getTime() <= start.getTime()) return { ok: false, fieldErrors: { endTime: TECHNICAL_ASSIGNMENT_MESSAGES.endBeforeStart } };

  return {
    ok: true,
    data: {
      ...(requireStaff ? { staffId } : {}),
      venueBookingId,
      start: start.toISOString(),
      end: end.toISOString(),
      note: note || null,
    },
  };
}

/** AC3: cancelling needs a reason, which the technician is told. */
export function parseTechnicalAssignmentCancel(body: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = text((body as { reason?: unknown } | null | undefined)?.reason);
  if (!reason) return { ok: false, error: TECHNICAL_ASSIGNMENT_MESSAGES.reasonMissing };
  if (reason.length > TECHNICAL_ASSIGNMENT_REASON_MAX) return { ok: false, error: TECHNICAL_ASSIGNMENT_MESSAGES.reasonTooLong };
  return { ok: true, reason };
}

export const TECHNICAL_ASSIGNMENT_STATUSES = ["ASSIGNED", "ACKNOWLEDGED", "CANCELLED"] as const;
export type TechnicalAssignmentStatus = (typeof TECHNICAL_ASSIGNMENT_STATUSES)[number];

export const TECHNICAL_ASSIGNMENT_STATUS_LABELS: Record<TechnicalAssignmentStatus, string> = {
  ASSIGNED: "Assigned",
  ACKNOWLEDGED: "Acknowledged",
  CANCELLED: "Cancelled",
};

/** AC5: what the coordinator sees. A change clears the acknowledgement (migration 41), so it is always current. */
export function technicalAssignmentStatus(a: { cancelledAt: string | null; acknowledgedAt: string | null }): TechnicalAssignmentStatus {
  if (a.cancelledAt) return "CANCELLED";
  return a.acknowledgedAt ? "ACKNOWLEDGED" : "ASSIGNED";
}

/** AC4: the notifications the technician can acknowledge (migration 41 writes them). */
export const ACKNOWLEDGEABLE_NOTIFICATION_TYPES = ["technical_assignment_assigned", "technical_assignment_changed"] as const;
