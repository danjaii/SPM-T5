import type { TechnicalAssignmentInput } from "@spm-t5/shared";
import {
  AssignmentStoreError,
  type AssignmentRecord,
  type TechnicalAssignmentStore,
} from "../../src/repositories/technicalAssignmentStore";

/** Aaron Koh in the Grand Hall for "DevOps Summit" (evt-devops), 15 Oct 2026, 08:00 to 17:00 Singapore time; Assigned. */
export const anAssignment = (overrides: Partial<AssignmentRecord> = {}): AssignmentRecord => ({
  id: "asg-1",
  eventId: "evt-devops",
  staffId: "tech-1",
  staffName: "Aaron Koh",
  venueBookingId: "vb-hall",
  venueName: "Grand Hall",
  start: new Date("2026-10-15T00:00:00Z"),
  end: new Date("2026-10-15T09:00:00Z"),
  note: "Livestream desk",
  acknowledgedAt: null,
  cancelledAt: null,
  cancellationReason: null,
  ...overrides,
});

/**
 * SCRUM-20: a fake assignment store. It keeps the assignments in memory and records every write. Set `refuse` to make
 * the next write fail as the database function would (migration 41 is tested against Postgres in tests/integration).
 */
export class FakeTechnicalAssignmentStore implements TechnicalAssignmentStore {
  readonly writes: { op: string; args: unknown[] }[] = [];
  refuse?: { code: string; message: string };
  private counter = 0;

  constructor(
    readonly rows: AssignmentRecord[] = [],
    private readonly staff: { id: string; name: string }[] = [
      { id: "tech-1", name: "Aaron Koh" },
      { id: "tech-2", name: "Vanessa Lee" },
    ],
    private readonly venues: Record<string, string> = { "vb-hall": "Grand Hall", "vb-lotus": "Lotus Room" },
  ) {}

  async forEvent(eventId: string) {
    return this.rows.filter((r) => r.eventId === eventId);
  }

  async find(id: string) {
    return this.rows.find((r) => r.id === id);
  }

  async staffOptions() {
    return [...this.staff];
  }

  private record(op: string, args: unknown[]) {
    this.writes.push({ op, args });
    if (this.refuse) throw new AssignmentStoreError(this.refuse.code, this.refuse.message);
  }

  async assign(eventId: string, input: TechnicalAssignmentInput & { staffId: string }) {
    this.record("assign", [eventId, input]);
    const id = `asg-new-${++this.counter}`;
    this.rows.push(
      anAssignment({
        id,
        eventId,
        staffId: input.staffId,
        staffName: this.staff.find((s) => s.id === input.staffId)?.name ?? null,
        venueBookingId: input.venueBookingId,
        venueName: this.venues[input.venueBookingId] ?? null,
        start: new Date(input.start),
        end: new Date(input.end),
        note: input.note,
      }),
    );
    return id;
  }

  async change(id: string, input: TechnicalAssignmentInput) {
    this.record("change", [id, input]);
    Object.assign(this.rows.find((r) => r.id === id)!, {
      venueBookingId: input.venueBookingId,
      venueName: this.venues[input.venueBookingId] ?? null,
      start: new Date(input.start),
      end: new Date(input.end),
      note: input.note,
      acknowledgedAt: null,
    });
  }

  async cancel(id: string, reason: string) {
    this.record("cancel", [id, reason]);
    Object.assign(this.rows.find((r) => r.id === id)!, { cancelledAt: new Date("2026-10-16T02:00:00Z"), cancellationReason: reason });
  }
}
