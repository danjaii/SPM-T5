import type { BookingRow, EventRow, TestData, VenueRow } from "./data";

/** A far-future day, so nothing depends on today's date (the same choice the old specs made). */
export const DAY = "2031-11-14";

export interface HeldVenue {
  venue: VenueRow;
  /** The event whose booking holds the venue, assigned to the second coordinator. */
  holder: EventRow;
  holding: BookingRow;
  /** The event the first coordinator will request the venue for. */
  requester: EventRow;
}

/**
 * A venue with the given buffers, held from 10:00 to 12:00 on DAY by another event's booking, plus a second event assigned to
 * the signed-in coordinator ("coordinator") to request it for. The customer's worked example is 30 and 45 minutes, which
 * occupies 09:30 to 12:45.
 */
export async function heldVenue(
  data: TestData,
  opts: { setupMinutes?: number; turnaroundMinutes?: number; holderStatus?: "approved" | "requested" } = {},
): Promise<HeldVenue> {
  const venue = await data.venue({ setupMinutes: opts.setupMinutes, turnaroundMinutes: opts.turnaroundMinutes });
  const holder = await data.event({ coordinator: "coordinator2", label: "Holder" });
  const holding = await data.booking({ event: holder, venue, requestedBy: "coordinator2", day: DAY, start: "10:00", end: "12:00", status: opts.holderStatus ?? "approved" });
  const requester = await data.event({ coordinator: "coordinator", label: "Requester" });
  return { venue, holder, holding, requester };
}
