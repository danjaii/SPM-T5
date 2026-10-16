import {
  canRequestEquipment,
  EQUIPMENT_REQUEST_REVIEW_DB_STATUS,
  EQUIPMENT_REQUEST_REVIEW_MESSAGES,
  EQUIPMENT_REQUEST_STATUS_LABELS,
  equipmentOptionLabel,
  equipmentRequestStatusOf,
  isWaitingEquipmentRequest,
  parseEquipmentRequestReviewInput,
  utcToSgt,
  type EquipmentRequestStatus,
} from "@spm-t5/shared";
import { eventLocked, forbidden, notFound, notWaiting, tooFewToArrange, validationFailed } from "../domain/errors";
import type { Ports } from "../ports";
import type { EquipmentRequestInfo } from "../readers/equipmentRequestReader";
import type { Caller } from "./availabilityService";

/** SCRUM-87/AC1: one row of the queue. Dates are Singapore time. */
export interface EquipmentQueueItem {
  id: string;
  eventId: string;
  eventName: string;
  /** The event's date, or the request's own date for an event with no date yet. */
  eventDate: string;
  venueName: string | null;
  equipment: string;
  quantity: number;
  status: EquipmentRequestStatus;
  statusLabel: string;
}

/** SCRUM-87/AC3: one request in full. Dates and times are Singapore time. */
export interface EquipmentRequestDetail extends EquipmentQueueItem {
  /** The period the equipment is needed for (from the venue booking). */
  startTime: string;
  endTime: string;
  notes: string | null;
  /** AC5: why it cannot be fulfilled, once staff said so. */
  reason: string | null;
  /** AC4: whether its status can still be changed (Submitted or Under Review, for an event that is not finished). */
  canReview: boolean;
}

/** The status a row shows as; the reader only returns rows that have one, apart from cancelled ones. */
function shownStatus(r: EquipmentRequestInfo): EquipmentRequestStatus | undefined {
  return equipmentRequestStatusOf(r.status);
}

function toQueueItem(r: EquipmentRequestInfo, status: EquipmentRequestStatus): EquipmentQueueItem {
  return {
    id: r.id,
    eventId: r.eventId,
    eventName: r.eventName,
    eventDate: utcToSgt(r.eventStart ?? r.start).date,
    venueName: r.venueName,
    equipment: equipmentOptionLabel({ type: r.equipmentType, name: r.equipmentName }),
    quantity: r.quantity,
    status,
    statusLabel: EQUIPMENT_REQUEST_STATUS_LABELS[status],
  };
}

/** SCRUM-87: Technical Support Staff see the requests waiting for them and change their status. */
export class EquipmentReviewService {
  constructor(private readonly ports: Ports) {}

  /**
   * AC7: an allow-list, like SCRUM-18 (18-S13). Only Technical Support Staff; every other role, including ones added
   * later, is refused by default.
   */
  private requireTechnicalSupport(caller: Caller) {
    if (caller.role !== "technical_support_staff") throw forbidden();
  }

  /**
   * AC1: Submitted and Under Review requests, soonest event first (then the oldest request). AC2: none gives an empty
   * list, which the page shows as "No requests waiting for action". Decision: a finished event's requests are left out.
   */
  async queue(caller: Caller): Promise<EquipmentQueueItem[]> {
    this.requireTechnicalSupport(caller);
    const when = (r: EquipmentRequestInfo) => (r.eventStart ?? r.start).getTime();
    const items: EquipmentQueueItem[] = [];
    for (const r of (await this.ports.requests.waiting()).sort(
      (a, b) => when(a) - when(b) || a.createdAt.getTime() - b.createdAt.getTime(),
    )) {
      const status = shownStatus(r);
      if (status && isWaitingEquipmentRequest(status) && canRequestEquipment(r.eventStatus)) {
        items.push(toQueueItem(r, status));
      }
    }
    return items;
  }

  /** The request with this id and the status it shows as; a cancelled one counts as not found. */
  private async load(id: string): Promise<{ r: EquipmentRequestInfo; status: EquipmentRequestStatus }> {
    const r = await this.ports.requests.find(id);
    const status = r && shownStatus(r);
    if (!r || !status) throw notFound("Equipment request not found.");
    return { r, status };
  }

  private toDetail(r: EquipmentRequestInfo, status: EquipmentRequestStatus): EquipmentRequestDetail {
    return {
      ...toQueueItem(r, status),
      startTime: utcToSgt(r.start).time,
      endTime: utcToSgt(r.end).time,
      notes: r.notes,
      reason: r.reviewReason,
      canReview: isWaitingEquipmentRequest(status) && canRequestEquipment(r.eventStatus),
    };
  }

  /** AC3: one request in any status, opened from the queue or by its address. */
  async detail(caller: Caller, id: string): Promise<EquipmentRequestDetail> {
    this.requireTechnicalSupport(caller);
    const { r, status } = await this.load(id);
    return this.toDetail(r, status);
  }

  /**
   * AC4: moves a waiting request to Under Review, Arranged or Cannot Fulfil. AC5: Cannot Fulfil needs a reason.
   * Decision: Arranged is refused when too few units are free. The database function checks all of this again, in
   * one step, so a stale screen or two staff saving at once still get a clear refusal. Returns the updated request.
   */
  async review(caller: Caller, id: string, body: unknown): Promise<EquipmentRequestDetail> {
    this.requireTechnicalSupport(caller);
    const parsed = parseEquipmentRequestReviewInput(body);
    if (!parsed.ok) throw validationFailed(parsed.fieldErrors);

    const { r, status } = await this.load(id);
    if (!canRequestEquipment(r.eventStatus)) throw eventLocked(EQUIPMENT_REQUEST_REVIEW_MESSAGES.eventLocked);
    if (!isWaitingEquipmentRequest(status)) throw notWaiting(EQUIPMENT_REQUEST_REVIEW_MESSAGES.notWaiting);

    const result = await this.ports.reviewer.review({
      requestId: id,
      dbStatus: EQUIPMENT_REQUEST_REVIEW_DB_STATUS[parsed.data.status],
      reason: parsed.data.reason,
    });
    switch (result.outcome) {
      case "not_found":
        throw notFound("Equipment request not found.");
      case "not_reviewable":
        throw notWaiting(EQUIPMENT_REQUEST_REVIEW_MESSAGES.notWaiting);
      case "event_locked":
        throw eventLocked(EQUIPMENT_REQUEST_REVIEW_MESSAGES.eventLocked);
      case "insufficient":
        throw tooFewToArrange(result.available, r.quantity);
    }
    return this.detail(caller, id);
  }
}
