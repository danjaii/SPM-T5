import {
  canRequestEquipment,
  EQUIPMENT_REQUEST_EDIT_MESSAGES,
  EQUIPMENT_REQUEST_MESSAGES,
  EQUIPMENT_READINESS_LABELS,
  EQUIPMENT_REQUEST_STATUS_LABELS,
  equipmentOptionLabel,
  equipmentReadiness,
  equipmentRequestStatusOf,
  isEditableEquipmentRequest,
  isRequestableEquipment,
  isRequestableVenueBooking,
  parseEquipmentRequestInput,
  utcToSgt,
  type EquipmentReadiness,
  type EquipmentRequestStatus,
} from "@spm-t5/shared";
import { eventLocked, forbidden, notEditable, notFound, validationFailed } from "../domain/errors";
import type { Ports } from "../ports";
import type { EquipmentRequestInfo } from "../readers/equipmentRequestReader";
import type { EventInfo } from "../readers/eventReader";
import type { Caller } from "./availabilityService";

/** One item in the form's equipment list, labelled with its type ("Audio: Wireless Microphone Set"). */
export interface EquipmentOption {
  id: string;
  label: string;
}

/** One of the event's approved venue bookings, for the form's venue list. Date and times are Singapore time. */
export interface VenueOption {
  id: string;
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
}

/** GET /events/:id/equipment-request-form: everything the form needs. */
export interface EquipmentRequestForm {
  event: { id: string; name: string };
  equipment: EquipmentOption[];
  venues: VenueOption[];
}

/** SCRUM-88/AC1: the request's current details, for the change form. */
export interface EquipmentRequestCurrent {
  id: string;
  equipmentId: string;
  quantity: number;
  venueBookingId: string | null;
  notes: string | null;
  status: EquipmentRequestStatus;
  statusLabel: string;
}

/** GET /events/:id/equipment-requests/:requestId/edit-form: the form, starting on the request's current details. */
export interface EquipmentRequestEditForm extends EquipmentRequestForm {
  request: EquipmentRequestCurrent;
}

/** SCRUM-86/AC2: one request as the event shows it. */
export interface EquipmentRequestView {
  id: string;
  /** SCRUM-88/AC1: the catalogue item, so the change form starts on it. */
  equipmentId: string;
  equipment: string;
  quantity: number;
  /** null for a row made before requests named a venue. */
  venueName: string | null;
  /** SCRUM-102: the venue booking it is for, so the event page can say what cancelling or changing it affects. */
  venueBookingId: string | null;
  notes: string | null;
  status: EquipmentRequestStatus;
  statusLabel: string;
  /** SCRUM-87/AC5: why it cannot be fulfilled, once Technical Support Staff said so. */
  reason: string | null;
  /** SCRUM-102 (102-S31): for a Released one, why its venue booking was cancelled; null otherwise. */
  releasedReason: string | null;
  /** SCRUM-88/AC1, AC4, AC6: whether the viewer may change it (the assigned coordinator, an open event, not Released). */
  canEdit: boolean;
  /** SCRUM-88/AC8: who last changed it, and when (Singapore time, "2026-10-15 17:40"); null if never changed. */
  lastChangedBy: string | null;
  lastChangedAt: string | null;
}

/** GET /events/:id/equipment-requests: the event's requests, and whether the caller may add one. */
export interface EventEquipmentRequests {
  requests: EquipmentRequestView[];
  canCreate: boolean;
  /** SCRUM-87/AC6: whether the event's equipment is ready; null when nothing has been requested. */
  readiness: EquipmentReadiness | null;
  readinessLabel: string | null;
}

/** SCRUM-88/AC8: a moment as "2026-10-15 17:40", Singapore time. */
export function sgtMoment(instant: Date | null): string | null {
  if (!instant) return null;
  const { date, time } = utcToSgt(instant);
  return `${date} ${time}`;
}

/** SCRUM-86: an Event Coordinator requests equipment for their event. SCRUM-88: and changes a request. */
export class EquipmentRequestService {
  constructor(private readonly ports: Ports) {}

  /** AC7: only the event's assigned coordinator. AC6: not for a finished event. Returns the event. */
  private async eventToRequestFor(
    caller: Caller,
    eventId: string,
    lockedMessage: string = EQUIPMENT_REQUEST_MESSAGES.eventLocked,
  ): Promise<EventInfo> {
    if (caller.role !== "event_coordinator") throw forbidden();
    const event = await this.ports.events.find(eventId);
    if (!event) throw notFound("Event not found.");
    if (event.assignedCoordinatorId !== caller.id) throw forbidden();
    if (!canRequestEquipment(event.status)) throw eventLocked(lockedMessage);
    return event;
  }

  /** The items that can be asked for, by label (decision: every catalogue item except retired ones). */
  private async equipmentOptions(): Promise<Array<EquipmentOption & { name: string }>> {
    return (await this.ports.equipment.list())
      .filter((item) => isRequestableEquipment(item.operationalStatus))
      .map((item) => ({ id: item.id, name: item.name, label: equipmentOptionLabel(item) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /** Open question 1 (decision): the event's approved bookings. */
  private async requestableBookings(eventId: string) {
    return (await this.ports.venueBookings.forEvent(eventId)).filter(
      (b) => b.eventId === eventId && isRequestableVenueBooking(b.status),
    );
  }

  /** AC1: the form, for the assigned coordinator of an event that is not finished. */
  async form(caller: Caller, eventId: string): Promise<EquipmentRequestForm> {
    const event = await this.eventToRequestFor(caller, eventId);
    const [equipment, bookings] = await Promise.all([this.equipmentOptions(), this.requestableBookings(eventId)]);
    return {
      event: { id: event.id, name: event.name },
      equipment: equipment.map(({ id, label }) => ({ id, label })),
      venues: bookings.map((b) => {
        const start = utcToSgt(b.start);
        return { id: b.id, venueName: b.venueName, date: start.date, startTime: start.time, endTime: utcToSgt(b.end).time };
      }),
    };
  }

  /**
   * AC4, AC5 (and SCRUM-88/AC3): checks the form's fields, that the item is one the form offers and the venue one of
   * the event's approved bookings, and works out the period the request covers. Throws 422 if anything is wrong.
   */
  private async checkedDetails(event: EventInfo, body: unknown) {
    const parsed = parseEquipmentRequestInput(body);
    if (!parsed.ok) throw validationFailed(parsed.fieldErrors);
    const { equipmentId, venueBookingId } = parsed.data;

    // AC1: the item must be one the form offers; anything else counts as none chosen (the form cannot send one).
    const item = (await this.equipmentOptions()).find((o) => o.id === equipmentId);
    if (!item) throw validationFailed({ equipmentId: EQUIPMENT_REQUEST_MESSAGES.equipmentMissing });

    // The venue must be one of this event's approved bookings; the request covers the booked period.
    const booking = venueBookingId ? (await this.requestableBookings(event.id)).find((b) => b.id === venueBookingId) : undefined;
    if (venueBookingId && !booking) throw validationFailed({ venueBookingId: EQUIPMENT_REQUEST_MESSAGES.venueMissing });
    // Without a venue (only if EQUIPMENT_REQUEST_VENUE_REQUIRED is turned off), the event's own dates are used.
    const period = booking ?? (event.start && event.end ? { start: event.start, end: event.end } : undefined);
    if (!period) throw validationFailed({ venueBookingId: EQUIPMENT_REQUEST_MESSAGES.venueMissing });
    return { details: parsed.data, item, venueName: booking?.venueName ?? null, period };
  }

  /** AC1: saves the request as Submitted, made by the signed-in coordinator. AC4, AC5: nothing is saved if invalid. */
  async create(caller: Caller, eventId: string, body: unknown): Promise<EquipmentRequestView> {
    const event = await this.eventToRequestFor(caller, eventId);
    const { details, item, venueName, period } = await this.checkedDetails(event, body);
    const { equipmentId, quantity, venueBookingId, notes } = details;

    const { id } = await this.ports.requestWriter.create({
      eventId,
      equipmentId,
      quantity,
      venueBookingId,
      notes,
      start: period.start,
      end: period.end,
      requestedBy: caller.id,
    });
    return {
      id,
      equipmentId,
      equipment: item.label,
      quantity,
      venueName,
      venueBookingId,
      notes,
      status: "SUBMITTED",
      statusLabel: EQUIPMENT_REQUEST_STATUS_LABELS.SUBMITTED,
      reason: null,
      releasedReason: null,
      canEdit: true,
      lastChangedBy: null,
      lastChangedAt: null,
    };
  }

  /**
   * SCRUM-88: the event's request with this id, for its assigned coordinator (AC5, AC6), on an event that is not
   * finished (AC4). Decision: a Released request cannot be changed (409).
   */
  private async requestToChange(caller: Caller, eventId: string, requestId: string) {
    const event = await this.eventToRequestFor(caller, eventId, EQUIPMENT_REQUEST_EDIT_MESSAGES.eventLocked);
    const r = await this.ports.requests.find(requestId);
    const status = r && equipmentRequestStatusOf(r.status);
    if (!r || !status || r.eventId !== eventId) throw notFound("Equipment request not found.");
    if (!isEditableEquipmentRequest(status)) throw notEditable(EQUIPMENT_REQUEST_EDIT_MESSAGES.notEditable);
    return { event, r, status };
  }

  /** SCRUM-88/AC1: the request form, starting on the request's current details. */
  async editForm(caller: Caller, eventId: string, requestId: string): Promise<EquipmentRequestEditForm> {
    const { r, status } = await this.requestToChange(caller, eventId, requestId);
    return {
      ...(await this.form(caller, eventId)),
      request: {
        id: r.id,
        equipmentId: r.equipmentId,
        quantity: r.quantity,
        venueBookingId: r.venueBookingId,
        notes: r.notes,
        status,
        statusLabel: EQUIPMENT_REQUEST_STATUS_LABELS[status],
      },
    };
  }

  /**
   * SCRUM-88/AC1: saves the new details. AC2: it goes back to Submitted (any change, open question 6), and Technical
   * Support Staff see it marked Updated. AC3: nothing is saved if a field is wrong, so the old details are kept.
   * Answers with the request as the event now shows it.
   */
  async update(caller: Caller, eventId: string, requestId: string, body: unknown): Promise<EquipmentRequestView> {
    const { event } = await this.requestToChange(caller, eventId, requestId);
    const { details, period } = await this.checkedDetails(event, body);

    const outcome = await this.ports.requestWriter.update({ requestId, ...details, start: period.start, end: period.end });
    switch (outcome) {
      case "not_found":
        throw notFound("Equipment request not found.");
      case "not_editable":
        throw notEditable(EQUIPMENT_REQUEST_EDIT_MESSAGES.notEditable);
      case "event_locked":
        throw eventLocked(EQUIPMENT_REQUEST_EDIT_MESSAGES.eventLocked);
      case "venue_invalid":
        throw validationFailed({ venueBookingId: EQUIPMENT_REQUEST_MESSAGES.venueMissing });
    }
    const saved = await this.ports.requests.find(requestId);
    const status = saved && equipmentRequestStatusOf(saved.status);
    if (!saved || !status) throw notFound("Equipment request not found.");
    return this.toView(saved, status, true);
  }

  /**
   * AC2, AC3: the event's requests, each with its own status, and SCRUM-87/AC5, AC6 the Cannot Fulfil reason and
   * whether the equipment is ready. The assigned coordinator sees them, and Technical Support Staff, who act on them
   * (SCRUM-87). Open question 4 (the Lead and Safety Officer) is decided here. AC6, AC7: canCreate says whether the
   * caller may add one; SCRUM-88: canEdit on each request whether they may change it.
   */
  async forEvent(caller: Caller, eventId: string): Promise<EventEquipmentRequests> {
    const event = await this.ports.events.find(eventId);
    if (!event) throw notFound("Event not found.");
    const isAssigned = caller.role === "event_coordinator" && event.assignedCoordinatorId === caller.id;
    if (!isAssigned && caller.role !== "technical_support_staff") throw forbidden();

    // SCRUM-88/AC4, AC6: the same people who may add a request may change one
    const mayChange = isAssigned && canRequestEquipment(event.status);
    const requests: EquipmentRequestView[] = [];
    for (const r of await this.ports.requests.forEvent(eventId)) {
      const status = equipmentRequestStatusOf(r.status);
      if (status) requests.push(this.toView(r, status, mayChange));
    }
    const readiness = equipmentReadiness(requests.map((r) => r.status));
    return {
      requests,
      canCreate: mayChange,
      readiness,
      readinessLabel: readiness && EQUIPMENT_READINESS_LABELS[readiness],
    };
  }

  private toView(r: EquipmentRequestInfo, status: EquipmentRequestStatus, mayChange: boolean): EquipmentRequestView {
    return {
      id: r.id,
      equipmentId: r.equipmentId,
      equipment: equipmentOptionLabel({ type: r.equipmentType, name: r.equipmentName }),
      quantity: r.quantity,
      venueName: r.venueName,
      venueBookingId: r.venueBookingId,
      notes: r.notes,
      status,
      statusLabel: EQUIPMENT_REQUEST_STATUS_LABELS[status],
      // a changed venue booking sends a Cannot Fulfil request back to Submitted (migration 30), so the old reason goes
      reason: status === "CANNOT_FULFIL" ? r.reviewReason : null,
      // only a cancelled venue booking has a reason, and cancelling it released all its equipment (migration 30)
      releasedReason: r.venueBookingCancellationReason,
      canEdit: mayChange && isEditableEquipmentRequest(status),
      lastChangedBy: r.lastChangedBy,
      lastChangedAt: sgtMoment(r.lastChangedAt),
    };
  }
}
