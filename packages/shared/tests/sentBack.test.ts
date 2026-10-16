import { describe, expect, it } from "vitest";
import { layoutIdsIn, sentBackNote } from "../src/sentBack";

// ----------------------------------------------------------------------------
// SCRUM-113/AC3 (docs/specs/send-back-affected-arrangements.md): a venue booking or equipment request sent back for review
// stores the event's changes ({ field: { from, to } }, migration 40). sentBackNote turns them into the lines Venue Staff
// and Technical Support Staff read, so venue-service and equipment-service word them the same way.
// ----------------------------------------------------------------------------

const AT = "2026-10-16T02:00:00.000Z";
const LAYOUTS = new Map([
  ["layout-theatre", "Theatre"],
  ["layout-banquet", "Banquet"],
]);

describe("SCRUM-113/AC3 what changed, as staff read it", () => {
  it("113-S7: nothing when it was never sent back", () => {
    expect(sentBackNote(null, null)).toBeNull();
    expect(sentBackNote({ expected_attendance: { from: 480, to: 600 } }, null)).toBeNull();
  });

  it("113-S7: each important change with its label, old and new value, in the edit form's order, and when", () => {
    const note = sentBackNote(
      {
        expected_attendance: { from: 480, to: 600 },
        preferred_start_datetime: { from: "2026-12-12T01:00:00.000Z", to: "2026-12-13T01:00:00.000Z" },
      },
      AT,
    );
    expect(note).toEqual({
      sentBackAt: AT,
      changes: [
        { field: "preferred_start_datetime", label: "Start", from: "2026-12-12T01:00:00.000Z", to: "2026-12-13T01:00:00.000Z" },
        { field: "expected_attendance", label: "Expected attendance", from: 480, to: 600 },
      ],
    });
  });

  it("113-S7: ordinary changes saved at the same time (the name) are left out", () => {
    const note = sentBackNote({ name: { from: "A", to: "B" }, venue_requirements: { from: null, to: "Stage" } }, AT);
    expect(note?.changes.map((c) => c.field)).toEqual(["venue_requirements"]);
  });

  it("113-S7: a room layout is shown by its name, an unknown one says so, and none stays empty", () => {
    const note = sentBackNote(
      { preferred_room_layout_id: { from: "layout-theatre", to: "layout-gone" } },
      AT,
      LAYOUTS,
    );
    expect(note?.changes[0]).toMatchObject({ label: "Room layout", from: "Theatre", to: "Unknown room layout" });
    const fromNone = sentBackNote({ preferred_room_layout_id: { from: null, to: "layout-banquet" } }, AT, LAYOUTS);
    expect(fromNone?.changes[0]).toMatchObject({ from: null, to: "Banquet" });
  });

  it("113-S7: layoutIdsIn gives the room layout ids to look up, and none when the layout did not change", () => {
    expect(layoutIdsIn({ preferred_room_layout_id: { from: "layout-theatre", to: null } })).toEqual(["layout-theatre"]);
    expect(layoutIdsIn({ expected_attendance: { from: 1, to: 2 } })).toEqual([]);
    expect(layoutIdsIn(null)).toEqual([]);
  });
});
