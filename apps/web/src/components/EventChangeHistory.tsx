import type { EventChangeHistoryEntry } from "@/lib/events";

const TIMES = new Set(["preferred_start_datetime", "preferred_end_datetime"]);

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" });

/** A value as people read it: times in Singapore time, and "(none)" for an empty one. */
export function changeValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "(none)";
  if (TIMES.has(field) && typeof value === "string") return formatWhen(value);
  return String(value);
}

// SCRUM-111/AC4: who changed the event's details, when, and each field's old and new value, newest first. Shown to the
// event's coordinator and organiser (event-service answers nobody else; null means no section).
export function EventChangeHistory({ entries }: { entries: EventChangeHistoryEntry[] | null }) {
  if (!entries) return null;
  return (
    <section className="event-section" aria-labelledby="change-history-heading">
      <h2 id="change-history-heading">Change history</h2>
      {entries.length === 0 ? (
        <p className="event-detail-card event-detail-card--quiet">The event&apos;s details have not been changed.</p>
      ) : (
        <ol className="change-history">
          {entries.map((entry) => (
            <li key={entry.id} className="event-detail-card">
              <p className="change-history__who">
                {formatWhen(entry.changedAt)} by {entry.changedBy ?? "Unknown"}
                {entry.important && <span className="status-badge change-history__important">Important</span>}
              </p>
              <ul>
                {entry.changes.map((c) => (
                  <li key={c.field}>
                    <strong>{c.label}:</strong> {changeValue(c.field, c.from)} → {changeValue(c.field, c.to)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
