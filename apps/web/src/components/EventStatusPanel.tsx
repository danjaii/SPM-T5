"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { EVENT_STATUSES, VENUE_BOOKING_MESSAGES, canRequestVenue } from "@spm-t5/shared";
import { changeEventStatus, statusLabel, type EventStatusView } from "@/lib/events";

// SCRUM-6/7: shows an event's current status. SCRUM-8: the assigned coordinator can also change it.
export function EventStatusPanel({ event }: { event: EventStatusView }) {
  const [status, setStatus] = useState(event.status);
  const [newStatus, setNewStatus] = useState(event.status);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string }>();
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(undefined);
    setSaving(true);
    const { ok, data } = await changeEventStatus(event.id, newStatus, reason);
    if (ok) {
      setStatus(data.status);
      setReason("");
      setMessage({ kind: "ok", text: `Status updated to ${statusLabel(data.status)}.` });
    } else {
      setMessage({ kind: "error", text: data.error ?? "We couldn't update the status. Please try again." });
    }
    setSaving(false);
  }

  return (
    <section className="event">
      <h1>{event.name}</h1>
      <p className="event__status">
        Status <span className="status-badge">{statusLabel(status)}</span>
      </p>

      {message && (
        <div className={`alert alert--${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </div>
      )}

      {/* SCRUM-32/AC3: the assigned coordinator can request a venue once the event is approved (32-S2, 32-S3). */}
      {event.canChangeStatus &&
        (canRequestVenue(status) ? (
          <p>
            <Link href={`/events/${event.id}/venue-request`}>Request a venue</Link>
          </p>
        ) : (
          <p className="field__hint">{VENUE_BOOKING_MESSAGES.EVENT_NOT_ELIGIBLE}</p>
        ))}

      {event.canChangeStatus && (
        <form className="event__form" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="new-status">New status</label>
            <select id="new-status" value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
              {EVENT_STATUSES.map((s) => (
                <option key={s} value={s}>{statusLabel(s)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="reason">Reason (optional)</label>
            <textarea id="reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <button className="btn" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </form>
      )}
    </section>
  );
}
