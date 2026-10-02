import type { EventInfo, EventReader } from "../../src/readers/eventReader";

/** An in-memory EventReader for unit tests (DR16). */
export class FakeEventReader implements EventReader {
  private readonly events = new Map<string, EventInfo>();

  constructor(events: EventInfo[] = []) {
    for (const e of events) this.events.set(e.id, e);
  }

  add(event: EventInfo) {
    this.events.set(event.id, event);
  }

  async getById(eventId: string) {
    return this.events.get(eventId) ?? null;
  }

  async listIdsAssignedTo(userId: string) {
    return [...this.events.values()].filter((e) => e.assignedCoordinatorId === userId).map((e) => e.id);
  }
}

/** An approved event assigned to `coordinator-1`, with a slot on 2030-11-14 (SGT 09:00-17:00). */
export function anEvent(overrides: Partial<EventInfo> = {}): EventInfo {
  return {
    id: "event-1",
    name: "Summit B",
    status: "approved",
    assignedCoordinatorId: "coordinator-1",
    expectedAttendance: 50,
    venueRequirements: "Theatre",
    accessibilityNeeds: null,
    proposedStart: new Date("2030-11-14T01:00:00.000Z"),
    proposedEnd: new Date("2030-11-14T09:00:00.000Z"),
    ...overrides,
  };
}
