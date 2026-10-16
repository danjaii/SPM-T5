import type { AffectedArrangement } from "@spm-t5/shared";
import { formatEventDateTime } from "@/lib/formatEventDateTime";

const KIND_LABELS: Record<AffectedArrangement["kind"], string> = {
  venue_booking: "Venue booking",
  equipment_request: "Equipment request",
};

// SCRUM-112: before an important change is saved, the venue bookings and equipment requests it may affect, each with why
// (AC1 to AC3). Save anyway saves it (AC5); Go back leaves the event and its arrangements as they were (AC4).
export function EventImpactWarning({
  message,
  affected,
  saving,
  onConfirm,
  onCancel,
}: {
  message: string;
  affected: AffectedArrangement[];
  saving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="impact" role="region" aria-label="Affected arrangements">
      <h2>Check affected arrangements</h2>
      <p>{message}</p>
      <ul className="impact__list">
        {affected.map((a) => (
          <li key={`${a.kind}-${a.id}`} className="impact__item">
            <p className="impact__name">
              {KIND_LABELS[a.kind]}: {a.name}
              {a.quantity !== null && ` × ${a.quantity}`}
            </p>
            <p className="impact__meta">
              {formatEventDateTime(a.start, a.end)} · {a.statusLabel}
            </p>
            <ul className="impact__reasons">
              {a.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <div className="impact__actions">
        <button className="btn" type="button" onClick={onConfirm} disabled={saving}>
          {saving ? "Saving…" : "Save anyway"}
        </button>
        <button className="btn btn--secondary" type="button" onClick={onCancel} disabled={saving}>
          Go back
        </button>
      </div>
    </section>
  );
}
