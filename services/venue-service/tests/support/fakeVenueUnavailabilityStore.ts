import type { UnavailabilityBlockRow } from "@spm-t5/shared";
import type { MarkUnavailable, VenueUnavailabilityStore } from "../../src/readers/venueUnavailabilityStore";

/** An in-memory VenueUnavailabilityStore for unit tests (SCRUM-105). `mark` records who made the block as "Kenneth Wong". */
export class FakeVenueUnavailabilityStore implements VenueUnavailabilityStore {
  readonly rows: (UnavailabilityBlockRow & { venueId: string })[] = [];
  /** Every call to mark(), so a test can see that nothing was written. */
  readonly marked: { venueId: string; input: MarkUnavailable }[] = [];
  /** The `withRecorder` flag of every list() call. */
  readonly listedWithRecorder: boolean[] = [];
  /** What the database would say it flagged (SCRUM-106); a test sets it. */
  affectedBookings = 0;
  private counter = 0;

  constructor(private readonly recordedAt: () => Date = () => new Date("2026-10-01T02:00:00.000Z")) {}

  /** Adds a block directly, for arranging a test. */
  seed(venueId: string, start: Date, end: Date, reason = "maintenance", notes: string | null = null): UnavailabilityBlockRow {
    const row = { id: `block-${++this.counter}`, venueId, start, end, reason, notes, recordedByName: "Kenneth Wong", recordedAt: this.recordedAt() };
    this.rows.push(row);
    return row;
  }

  async mark(venueId: string, input: MarkUnavailable): Promise<{ block: UnavailabilityBlockRow; affectedBookings: number }> {
    this.marked.push({ venueId, input });
    return { block: this.seed(venueId, input.start, input.end, input.reason, input.notes ?? null), affectedBookings: this.affectedBookings };
  }

  async list(venueId: string, withRecorder: boolean): Promise<UnavailabilityBlockRow[]> {
    this.listedWithRecorder.push(withRecorder);
    return this.rows
      .filter((r) => r.venueId === venueId)
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((r) => ({ ...r, recordedByName: withRecorder ? r.recordedByName : null }));
  }
}
