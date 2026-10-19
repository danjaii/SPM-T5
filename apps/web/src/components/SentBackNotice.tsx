import type { SentBackNote } from "@spm-t5/shared";
import { changeValue } from "@/components/EventChangeHistory";
import { formatSgt } from "@/lib/bookingQueue";

// SCRUM-113/AC3: a venue booking or equipment request sent back for review after an important event change, with what
// changed (label: old → new), so staff review it with the latest event information. Nothing when it was not sent back.
export function SentBackNotice({ note }: { note: SentBackNote | null | undefined }) {
  if (!note) return null;
  return (
    <section className="sent-back" aria-labelledby="sent-back-heading">
      <h2 id="sent-back-heading">Sent back for review</h2>
      <p>The event changed on {formatSgt(note.sentBackAt)}. Review this again with the latest event information.</p>
      {note.changes.length > 0 ? (
        <ul className="sent-back__changes">
          {note.changes.map((c) => (
            <li key={c.field}>
              {c.label}: {changeValue(c.field, c.from)} → {changeValue(c.field, c.to)}
            </li>
          ))}
        </ul>
      ) : (
        <p>None of the changes concern this request directly; check it still suits the event.</p>
      )}
    </section>
  );
}
