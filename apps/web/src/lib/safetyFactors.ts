import type { SafetyCheckDetails } from "./safetyCheckServer";

const NOT_RECORDED = "Not recorded";

/** The value, or "Not recorded": a gap in the safety information must be visible, not blank. */
const orNotRecorded = (value: string | number | null) => (value === null || value === "" ? NOT_RECORDED : value);

/** SCRUM-142/AC2: one factor of the Operational Safety Check and what is known about it. */
export interface SafetyFactor {
  id: string;
  title: string;
  lines: string[];
}

/**
 * SCRUM-142/AC2: the six factors, in the order of the Figma checklist. The layout sits in the first row with the capacity.
 * Venue facts are named by venue, because an event can be booked into several (SCRUM-98). Crowd movement has no source in
 * the safety information yet, so it reads "Not recorded" and the Safety Officer judges it from the rest.
 */
export function safetyFactors(details: SafetyCheckDetails): SafetyFactor[] {
  const { venues } = details;
  const layoutText = (layoutCapacity: number | null) =>
    !details.layout
      ? " (no layout chosen)"
      : layoutCapacity === null
        ? `, ${details.layout} layout not listed for this venue`
        : `, ${layoutCapacity} in ${details.layout} layout`;

  return [
    {
      id: "attendance",
      title: "Attendance vs capacity",
      lines: [
        `Expected attendance: ${orNotRecorded(details.expected_attendance)}`,
        ...venues.map((v) => `${v.name}: holds ${v.max_capacity}${layoutText(v.layout_capacity)}`),
      ],
    },
    { id: "emergency", title: "Emergency access", lines: venues.map((v) => `${v.name}: ${orNotRecorded(v.emergency_access)}`) },
    {
      id: "accessibility",
      title: "Accessibility",
      lines: [`Event: ${orNotRecorded(details.accessibility_requirements)}`, ...venues.map((v) => `${v.name}: ${orNotRecorded(v.accessibility_notes)}`)],
    },
    {
      id: "equipment",
      title: "Equipment placement",
      lines: details.equipment.length === 0
        ? ["No equipment requested"]
        : details.equipment.map((q) => `${q.name} × ${q.quantity}: ${orNotRecorded(q.placement)}`),
    },
    { id: "crowd", title: "Crowd movement", lines: [NOT_RECORDED] },
    {
      id: "restrictions",
      title: "Known venue restrictions",
      lines: [
        ...venues.map((v) => `${v.name}: ${orNotRecorded(v.restrictions)}`),
        ...venues.flatMap((v) => v.unavailability.map((u) => `${v.name} unavailable (${u.reason}): ${u.notes ?? NOT_RECORDED}`)),
      ],
    },
  ];
}

/**
 * SCRUM-142/AC3: the reason sent with a decision. event-service keeps one reason per decision, so the Safety Officer's own
 * note comes first and each concern follows as "Factor: what needs to change". A concern without a note adds nothing.
 */
export function composeReason(note: string, concerns: { title: string; note: string }[]): string {
  return [note.trim(), ...concerns.filter((c) => c.note.trim() !== "").map((c) => `${c.title}: ${c.note.trim()}`)]
    .filter(Boolean)
    .join("\n");
}
