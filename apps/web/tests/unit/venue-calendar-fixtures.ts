// Shared pretend GET /venue-calendar answers for the venue calendar tests (SCRUM-84). 14 Nov 2026 in Singapore (UTC+8): 10:00 is 02:00Z.
export interface PeriodFixture { [key: string]: unknown; kind: string; status: string; label: string; start: string; end: string }

export const period = (changes: PeriodFixture): PeriodFixture => changes;

export const openPeriod = (changes: Partial<PeriodFixture> = {}): PeriodFixture => ({
  kind: "open", status: "AVAILABLE", label: "Available", start: "2026-11-13T16:00:00.000Z", end: "2026-11-14T16:00:00.000Z", ...changes,
});

export const venueFixture = (changes: Record<string, unknown> = {}) => ({
  id: "orchid", name: "Orchid Hall", address: "1 Marina Boulevard", max_capacity: 150, operating_hours: null,
  setup_minutes: 30, turnaround_minutes: 45, periods: [openPeriod()], ...changes,
});

export const calendarFixture = (changes: Record<string, unknown> = {}) => ({
  range: { from: "2026-11-14", to: "2026-11-14", start: "2026-11-13T16:00:00.000Z", end: "2026-11-14T16:00:00.000Z", time_zone: "Asia/Singapore" },
  venues: [venueFixture(), venueFixture({ id: "jasmine", name: "Jasmine Room", address: "2 Marina Boulevard", max_capacity: 40 })],
  ...changes,
});

/** What fetch() resolves to for this status and JSON body. */
export const jsonReply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
