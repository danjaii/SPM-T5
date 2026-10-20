import { EmptyNote, EventSection } from "@/components/event/EventSection";
import { StatusBadge } from "@/components/ui/status-badge";
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
    <EventSection id="change-history-heading" title="Change history">
      {entries.length === 0 ? (
        <EmptyNote>The event&apos;s details have not been changed.</EmptyNote>
      ) : (
        <ol className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-2 rounded-lg border border-border p-4">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                {formatWhen(entry.changedAt)} by {entry.changedBy ?? "Unknown"}
                {entry.important && <StatusBadge tone="warning" label="Important" />}
              </p>
              <ul className="flex flex-col gap-1 text-sm">
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
    </EventSection>
  );
}
