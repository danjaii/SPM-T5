import { EVENT_FIELD_LABELS, EVENT_IMPORTANT_FIELDS } from "./eventDetails";

// SCRUM-113 (docs/specs/send-back-affected-arrangements.md): what changed on an event, as staff read it on a venue booking
// or equipment request sent back for review. The note is stored as the event's changes ({ field: { from, to } },
// migration 39); only the important fields are shown, because an ordinary change does not affect an arrangement.

export type SentBackChange = { field: string; label: string; from: unknown; to: unknown };
export type SentBackNote = { sentBackAt: string; changes: SentBackChange[] };

const LAYOUT_FIELD = "preferred_room_layout_id";
export const UNKNOWN_ROOM_LAYOUT = "Unknown room layout";

type StoredChanges = Record<string, { from: unknown; to: unknown }>;

function asChanges(changes: unknown): StoredChanges | null {
  return changes && typeof changes === "object" && !Array.isArray(changes) ? (changes as StoredChanges) : null;
}

/** AC3: the note's lines in the edit form's order, a room layout by name; null if it was never sent back. */
export function sentBackNote(
  changes: unknown,
  sentBackAt: string | null,
  layoutNames: ReadonlyMap<string, string> = new Map(),
): SentBackNote | null {
  const stored = asChanges(changes);
  if (!sentBackAt || !stored) return null;
  const shown = (field: string, value: unknown) =>
    field === LAYOUT_FIELD && typeof value === "string" ? (layoutNames.get(value) ?? UNKNOWN_ROOM_LAYOUT) : value;
  return {
    sentBackAt,
    changes: EVENT_IMPORTANT_FIELDS.filter((field) => field in stored).map((field) => ({
      field,
      label: EVENT_FIELD_LABELS[field],
      from: shown(field, stored[field].from),
      to: shown(field, stored[field].to),
    })),
  };
}

/** The room layout ids a note names, for looking up their names. */
export function layoutIdsIn(changes: unknown): string[] {
  const layout = asChanges(changes)?.[LAYOUT_FIELD];
  return layout ? [layout.from, layout.to].filter((id): id is string => typeof id === "string") : [];
}
