// SCRUM-168: whether a coordinator already has an active event whose preferred date and time overlaps the one the Lead is
// assigning. Preferred dates can still change, so the answer is a hint for the Lead, never a reason to refuse.

export interface CoordinatorEventSlot {
  id: string;
  name: string;
  preferred_start_datetime: string | null;
  preferred_end_datetime: string | null;
  expected_attendance: number | null;
}

export type CoordinatorClash =
  | { status: "clash"; eventId: string; eventName: string }
  | { status: "free" }
  /** The event being assigned has no preferred start, so nobody can be called free (AC5). */
  | { status: "no_date" }
  /** The coordinator's events could not be read, so nothing is claimed either way. */
  | { status: "unavailable" };

const time = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

/**
 * AC1, AC2, AC5: the first of `events` whose preferred period overlaps `event`'s. Periods that only touch (one ends as the
 * other starts) do not overlap. An event with no end counts as an instant at its start; one with no start cannot clash.
 */
export function coordinatorClash(
  event: Pick<CoordinatorEventSlot, "preferred_start_datetime" | "preferred_end_datetime">,
  events: CoordinatorEventSlot[],
): CoordinatorClash {
  const start = time(event.preferred_start_datetime);
  if (Number.isNaN(start)) return { status: "no_date" };
  const end = time(event.preferred_end_datetime);
  const eventEnd = Number.isNaN(end) ? start : end;

  const clashing = events.find((other) => {
    const otherStart = time(other.preferred_start_datetime);
    if (Number.isNaN(otherStart)) return false;
    const otherEnd = time(other.preferred_end_datetime);
    return start < (Number.isNaN(otherEnd) ? otherStart : otherEnd) && otherStart < eventEnd;
  });
  return clashing ? { status: "clash", eventId: clashing.id, eventName: clashing.name } : { status: "free" };
}

/** AC3: the people expected across a coordinator's active events; an event with no figure counts as 0. */
export function totalAttendance(events: CoordinatorEventSlot[]): number {
  return events.reduce((sum, e) => sum + (e.expected_attendance ?? 0), 0);
}
