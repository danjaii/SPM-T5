import {
  isClosedEventStatus,
  isRequestableVenueBooking,
  parseTechnicalAssignmentCancel,
  parseTechnicalAssignmentInput,
  TECHNICAL_ASSIGNMENT_MESSAGES,
  TECHNICAL_ASSIGNMENT_STATUS_LABELS,
  technicalAssignmentStatus,
  utcToSgt,
  type TechnicalAssignmentInput,
  type TechnicalAssignmentStatus,
} from "@spm-t5/shared";
import {
  alreadyAssigned,
  assignmentCancelled,
  eventLocked,
  forbidden,
  notFound,
  validationFailed,
} from "../domain/errors";
import type { Ports } from "../ports";
import type { EventInfo } from "../readers/eventReader";
import {
  AssignmentStoreError,
  type AssignmentRecord,
  type TechnicalAssignmentStore,
} from "../repositories/technicalAssignmentStore";
import type { Caller } from "./availabilityService";
import type { VenueOption } from "./equipmentRequestService";

/** SCRUM-20/AC5: one assignment as the coordinator sees it. Dates and times are Singapore time. */
export interface TechnicalAssignmentView {
  id: string;
  staffId: string;
  staffName: string | null;
  venueBookingId: string | null;
  venueName: string | null;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  note: string | null;
  status: TechnicalAssignmentStatus;
  statusLabel: string;
  acknowledgedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
}

/** GET /events/:id/technical-assignments: the list and what the assign form offers. */
export interface EventTechnicalAssignments {
  assignments: TechnicalAssignmentView[];
  /** False for a completed, cancelled or rejected event. */
  canAssign: boolean;
  staff: { id: string; name: string }[];
  venues: VenueOption[];
}

const LOCKED = "A completed, cancelled or rejected event's assignments can't be changed.";

export function toAssignmentView(a: AssignmentRecord): TechnicalAssignmentView {
  const start = utcToSgt(a.start);
  const end = utcToSgt(a.end);
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  const status = technicalAssignmentStatus({ cancelledAt: iso(a.cancelledAt), acknowledgedAt: iso(a.acknowledgedAt) });
  return {
    id: a.id,
    staffId: a.staffId,
    staffName: a.staffName,
    venueBookingId: a.venueBookingId,
    venueName: a.venueName,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    note: a.note,
    status,
    statusLabel: TECHNICAL_ASSIGNMENT_STATUS_LABELS[status],
    acknowledgedAt: iso(a.acknowledgedAt),
    cancelledAt: iso(a.cancelledAt),
    cancellationReason: a.cancellationReason,
  };
}

/** The database function's refusals (migration 41) as answers; anything else is unexpected (500). */
function translate(err: unknown): never {
  if (err instanceof AssignmentStoreError) {
    if (err.code === "23505") throw alreadyAssigned();
    if (err.code === "42501") throw forbidden();
    if (err.code === "CS112") throw eventLocked(LOCKED);
    if (err.code === "CS020") throw assignmentCancelled();
    if (err.code === "22023") throw validationFailed({ form: err.message });
  }
  throw err;
}

/** SCRUM-20: the event's coordinator assigns Technical Support Staff on-site; the database tells the technician. */
export class TechnicalAssignmentService {
  constructor(
    private readonly ports: Ports,
    private readonly store: TechnicalAssignmentStore,
  ) {}

  /** Only the event's current assigned coordinator (the database checks again). */
  private async eventFor(caller: Caller, eventId: string): Promise<EventInfo> {
    const event = await this.ports.events.find(eventId);
    if (!event) throw notFound("Event not found.");
    if (caller.role !== "event_coordinator" || event.assignedCoordinatorId !== caller.id) throw forbidden();
    return event;
  }

  /** The event's approved venue bookings, which an assignment can be for. */
  private async venueOptions(eventId: string): Promise<VenueOption[]> {
    return (await this.ports.venueBookings.forEvent(eventId))
      .filter((b) => b.eventId === eventId && isRequestableVenueBooking(b.status))
      .map((b) => {
        const start = utcToSgt(b.start);
        return { id: b.id, venueName: b.venueName, date: start.date, startTime: start.time, endTime: utcToSgt(b.end).time };
      });
  }

  /** The form's fields, plus the technician and venue booking checked against what may be chosen. */
  private async validInput(eventId: string, body: unknown, requireStaff: boolean): Promise<TechnicalAssignmentInput> {
    const parsed = parseTechnicalAssignmentInput(body, { requireStaff });
    if (!parsed.ok) throw validationFailed(parsed.fieldErrors);
    const [staff, venues] = await Promise.all([this.store.staffOptions(), this.venueOptions(eventId)]);
    const errors: Record<string, string> = {};
    if (requireStaff && !staff.some((s) => s.id === parsed.data.staffId)) errors.staffId = TECHNICAL_ASSIGNMENT_MESSAGES.staffMissing;
    if (!venues.some((v) => v.id === parsed.data.venueBookingId)) errors.venueBookingId = TECHNICAL_ASSIGNMENT_MESSAGES.venueBookingMissing;
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    return parsed.data;
  }

  /** An assignment the caller may change: theirs, of an open event, not cancelled. */
  private async changeable(caller: Caller, id: string): Promise<AssignmentRecord> {
    const assignment = await this.store.find(id);
    if (!assignment) throw notFound("Assignment not found.");
    const event = await this.eventFor(caller, assignment.eventId);
    if (isClosedEventStatus(event.status)) throw eventLocked(LOCKED);
    if (assignment.cancelledAt) throw assignmentCancelled();
    return assignment;
  }

  private async view(id: string): Promise<TechnicalAssignmentView> {
    return toAssignmentView((await this.store.find(id))!);
  }

  /** AC5: the event's assignments with their status, and what the form offers. */
  async forEvent(caller: Caller, eventId: string): Promise<EventTechnicalAssignments> {
    const event = await this.eventFor(caller, eventId);
    const [rows, staff, venues] = await Promise.all([
      this.store.forEvent(eventId),
      this.store.staffOptions(),
      this.venueOptions(eventId),
    ]);
    return { assignments: rows.map(toAssignmentView), canAssign: !isClosedEventStatus(event.status), staff, venues };
  }

  /** AC1: assign; the database writes the technician's notification. */
  async assign(caller: Caller, eventId: string, body: unknown): Promise<TechnicalAssignmentView> {
    const event = await this.eventFor(caller, eventId);
    if (isClosedEventStatus(event.status)) throw eventLocked(LOCKED);
    const input = (await this.validInput(eventId, body, true)) as TechnicalAssignmentInput & { staffId: string };
    const id = await this.store.assign(eventId, input).catch(translate);
    return this.view(id);
  }

  /** AC2: a new venue booking or period; the technician is told and acknowledges again. */
  async change(caller: Caller, id: string, body: unknown): Promise<TechnicalAssignmentView> {
    const assignment = await this.changeable(caller, id);
    await this.store.change(id, await this.validInput(assignment.eventId, body, false)).catch(translate);
    return this.view(id);
  }

  /** AC3: cancel with a reason, which the technician is told. */
  async cancel(caller: Caller, id: string, body: unknown): Promise<TechnicalAssignmentView> {
    await this.changeable(caller, id);
    const parsed = parseTechnicalAssignmentCancel(body);
    if (!parsed.ok) throw validationFailed({ reason: parsed.error });
    await this.store.cancel(id, parsed.reason).catch(translate);
    return this.view(id);
  }
}
