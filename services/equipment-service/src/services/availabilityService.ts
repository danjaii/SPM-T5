import { parseAvailabilityInput, type Role } from "@spm-t5/shared";
import { forbidden, validationFailed } from "../domain/errors";
import type { Ports } from "../ports";
import type { ReservationInfo } from "../readers/reservationReader";

/** Who is asking: their user id and role (undefined when they have none). */
export interface Caller {
  id: string;
  role: Role | undefined;
}

/** GET /equipment: one catalogue item, offered as a name suggestion. */
export interface EquipmentOption {
  id: string;
  name: string;
  type: string | null;
  totalQuantity: number;
  operationalStatus: string;
}

/** What the form sends: every value arrives as text in the web address. */
export type AvailabilityQuery = Record<string, unknown>;

export interface AvailabilityResult {
  equipmentId: string;
  equipmentName: string;
  operationalStatus: string;
  totalQuantity: number;
  requestedQuantity: number;
  availableQuantity: number;
  /** AC2: true when what is available meets or exceeds what was asked for. */
  sufficient: boolean;
  // this will tell us whther we have enough or not, based on the quantity we requested
  /** AC3: how many more would be needed; 0 when there is enough. */
  shortfall: number;
  date: string;
  startTime: string;
  endTime: string;
}

/** 18-S8: the reservation statuses that hold units. */
const COUNTED_STATUSES = ["approved", "reserved"];

/**
 * 18-S9: the most units out at any one moment between `start` and `end`. Each booking becomes two events,
 * units going out at its start and coming back at its end; walking through them in time order with a running
 * count, the highest count is the peak. Bookings that do not overlap each other therefore do not add up.
 */
function peakUnitsOut(start: Date, end: Date, bookings: ReservationInfo[]): number {
  const events: Array<{ at: number; change: number }> = [];
  for (const r of bookings) {
    const units = r.quantityReserved ?? r.quantityRequested;
    // Only the part of the booking inside the period being checked matters.
    const from = Math.max(r.start.getTime(), start.getTime());
    const to = Math.min(r.end.getTime(), end.getTime());
    if (from >= to) continue;
    events.push({ at: from, change: +units }, { at: to, change: -units });
  }
  // In time order; at the same moment, returns (negative) before departures, so back-to-back bookings never add up.
  events.sort((a, b) => a.at - b.at || a.change - b.change);

  let out = 0;
  let peak = 0;
  for (const event of events) {
    out += event.change;
    peak = Math.max(peak, out);
  }
  return peak;
}

/** SCRUM-18: Technical Support Staff check whether enough units of a piece of equipment are free. */
export class AvailabilityService {
  constructor(
    private readonly ports: Ports,
    /** The clock, so tests can fix "now" (AC7: a period in the past). */
    private readonly now: () => Date,
  ) {}

  /**
   * 18-S13: an allow-list. Only Technical Support Staff may use this page; every other role, including roles
   * added later (e.g. the Week 7 Event Coordinator Lead and Safety Officer), is refused by default.
   */
  private requireTechnicalSupport(caller: Caller) {
    if (caller.role !== "technical_support_staff") throw forbidden();
  }

  /** The catalogue names for the form's suggestions, A to Z, including items that are not usable. */
  async options(caller: Caller): Promise<EquipmentOption[]> {
    this.requireTechnicalSupport(caller);
    const items = await this.ports.equipment.list();
    return items
      .map(({ id, name, type, totalQuantity, operationalStatus }) => ({ id, name, type, totalQuantity, operationalStatus }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async check(caller: Caller, query: AvailabilityQuery): Promise<AvailabilityResult> {
    this.requireTechnicalSupport(caller);

    // AC4, AC6, AC7 and the quantity: the same checks the web form runs (packages/shared). Any problem: 422.
    const parsed = parseAvailabilityInput(query, this.now());
    if (!parsed.ok) throw validationFailed(parsed.fieldErrors);
    const { equipmentName, quantity: requestedQuantity, date, startTime, endTime, start, end } = parsed.data;

    // AC1: find the equipment, then subtract every unit booked during the period.
    // 18-S11: compare in lower case, so "projector UNIT" still finds "Projector Unit".
    const wanted = equipmentName.toLowerCase();
    const item = (await this.ports.equipment.list()).find((e) => e.name.toLowerCase() === wanted);
    // finds the equipment name and how many are there in total
    // AC5: no match means the name is invalid; say so instead of crashing.
    if (!item) {
      throw validationFailed({ equipmentName: `“${equipmentName}” does not match any equipment in the catalogue.` });
    }
    const bookings = await this.ports.reservations.overlapping(item.id, start, end);
    // finds bookings during that period of start and end 
    // 18-S8: only approved and reserved bookings hold units; requested, rejected and cancelled ones do not.
    const holding = bookings.filter((r) => COUNTED_STATUSES.includes(r.status));
    // 18-S9: not the sum of every booking, but the most units out at any one moment of the period.
    const booked = peakUnitsOut(start, end, holding);
    // adds up the total number of units booked during the period

    // 18-S10: damaged, under maintenance or retired equipment cannot be used at all, whatever is booked.
    const usable = item.operationalStatus === "available";
    const availableQuantity = usable ? item.totalQuantity - booked : 0;
    // tells us the available quantity

    return {
      equipmentId: item.id,
      equipmentName: item.name,
      operationalStatus: item.operationalStatus,
      totalQuantity: item.totalQuantity,
      requestedQuantity,
      availableQuantity,
      // AC2: enough when what is available meets or exceeds what was asked for
      sufficient: availableQuantity >= requestedQuantity,
      // if available quantity is greater than or equal to requested quantity, return true
      // AC3: how many short; never below 0, so "enough" shows 0 rather than a negative number
      shortfall: Math.max(0, requestedQuantity - availableQuantity),
      date,
      startTime,
      endTime,
    };
  }
}
