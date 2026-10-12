import { periodFormatErrors, periodMissing, periodTimingError, quantityError, utcToSgt } from "@spm-t5/shared";
import { forbidden, insufficient, validationFailed } from "../domain/errors";
import type { Ports } from "../ports";
import type { Caller } from "./availabilityService";

/** What the form sends in the body of POST /equipment-reservations. */
export type ReservationRequest = Record<string, unknown>;

/** AC2: what the user sees once the reservation is saved. Date and times are Singapore time, as entered. */
export interface ReservationConfirmation {
  id: string;
  equipmentName: string;
  quantity: number;
  date: string;
  startTime: string;
  endTime: string;
  /** How many are still free in that period after this reservation. */
  availableAfter: number;
}

/** 19-S14: one entry in the form's event dropdown. Date and times are Singapore time, ready to pre-fill the form. */
export interface ReservableEvent {
  id: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  coordinatorName: string | null;
}

/** 19-S9: the event statuses equipment can be reserved for. */
const ELIGIBLE_STATUSES = ["approved", "planning", "awaiting_arrangements", "confirmed"];

/** SCRUM-19: Technical Support Staff reserve equipment for an event. */
export class ReservationService {
  constructor(
    private readonly ports: Ports,
    /** The clock, so tests can fix "now". */
    private readonly now: () => Date,
  ) {}

  /**
   * 19-S13: only Technical Support Staff. An allow-list, so a role added later (e.g. the Week 7 Event Coordinator
   * Lead or Safety Officer) is refused by default.
   */
  private requireTechnicalSupport(caller: Caller) {
    if (caller.role !== "technical_support_staff") throw forbidden();
  }

  /** 19-S14: the events equipment can be reserved for (eligible, not started), soonest first. */
  async reservableEvents(caller: Caller): Promise<ReservableEvent[]> {
    this.requireTechnicalSupport(caller);
    const now = this.now();
    return (await this.ports.events.list())
      .filter((e) => ELIGIBLE_STATUSES.includes(e.status) && e.start && e.end && e.start > now)
      .sort((a, b) => a.start!.getTime() - b.start!.getTime())
      .map((e) => {
        const start = utcToSgt(e.start!);
        return {
          id: e.id,
          name: e.name,
          date: start.date,
          startTime: start.time,
          endTime: utcToSgt(e.end!).time,
          coordinatorName: e.coordinatorName,
        };
      });
  }

  /** AC1: hands the reservation to the writer, made by the signed-in staff member. AC2: confirms it. */
  async reserve(caller: Caller, body: ReservationRequest): Promise<ReservationConfirmation> {
    this.requireTechnicalSupport(caller);
    // if role is not technical support staff, throw forbidden error

    // Each field as text with the spaces around it removed; a field left out entirely counts as blank.
    const text = (value: unknown) => String(value ?? "").trim();
    const eventId = text(body.eventId);
    const equipmentId = text(body.equipmentId);
    const quantityText = text(body.quantity);
    const period = { date: text(body.date), startTime: text(body.startTime), endTime: text(body.endTime) };
    const { date, startTime, endTime } = period;

    // The same three stages as SCRUM-18, with its shared rules (packages/shared). Each stage collects a prompt for
    // every problem and refuses once (422), so the user sees them together; nothing is saved.
    // Stage 1, missing. 19-S9: no event selected. AC6: no equipment card selected. AC7: no quantity.
    // AC8: no date, start or end time.
    const missing: Record<string, string> = { ...periodMissing(period) };
    if (eventId === "") missing.eventId = "Please select the event.";
    if (equipmentId === "") missing.equipmentId = "Please select the equipment.";
    if (quantityText === "") missing.quantity = quantityError(quantityText)!;
    if (Object.keys(missing).length > 0) throw validationFailed(missing);

    // Stage 2, filled in but wrong. AC7: not a whole number of at least 1. AC8: a date or time in the wrong format.
    const invalid: Record<string, string> = { ...periodFormatErrors(period) };
    const quantityProblem = quantityError(quantityText);
    if (quantityProblem) invalid.quantity = quantityProblem;
    if (Object.keys(invalid).length > 0) throw validationFailed(invalid);

    // Stage 3. AC8: the end must be after the start, and the period must not be in the past.
    const timing = periodTimingError(period, this.now());
    if (!timing.ok) throw validationFailed(timing.fieldErrors);

    // 19-S9: the event must exist, be approved or further along, and not have started yet.
    const event = await this.ports.events.find(eventId);
    if (!event || !ELIGIBLE_STATUSES.includes(event.status) || (event.start && event.start <= this.now())) {
      throw validationFailed({ eventId: "Please select an approved event that has not started yet." });
    }

    const quantity = Number(quantityText);

    // AC6: an id that is not in the catalogue counts as no equipment selected (the form cannot send one).
    const item = (await this.ports.equipment.list()).find((e) => e.id === equipmentId);
    if (!item) throw validationFailed({ equipmentId: "Please select the equipment." });

    // 19-S10: damaged, under maintenance or retired equipment has none available, whatever the bookings say.
    if (item.operationalStatus !== "available") throw insufficient(0, quantity);

    const outcome = await this.ports.writer.reserve({
      eventId,
      equipmentId,
      quantity,
      start: timing.start,
      end: timing.end,
      reservedBy: caller.id,
    });
    // AC4: not enough free in that period. The writer saved nothing, so availability is unchanged (AC5).
    if (!outcome.ok) throw insufficient(outcome.available, quantity);

    // AC2: the form only sends the equipment's id, so confirm with the name a person recognises.
    return {
      id: outcome.id,
      equipmentName: item.name,
      quantity,
      date,
      startTime,
      endTime,
      availableAfter: outcome.availableAfter,
    };
  }
}
