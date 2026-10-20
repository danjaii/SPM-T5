"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { EVENT_STATUSES, VENUE_BOOKING_MESSAGES, canRequestVenue, canStartReview } from "@spm-t5/shared";
import { changeEventStatus, statusLabel, type EventStatusView } from "@/lib/events";
import { EventReviewActions } from "./EventReviewActions";
import EventStatusBadge from "./EventStatusBadge";
import { StatusStepper } from "./event/StatusStepper";

// SCRUM-6/7: shows an event's current status. SCRUM-8: the assigned coordinator can also change it.
// SCRUM-45: the assigned coordinator starts the review. SCRUM-24: they also approve or reject it.
export function EventStatusPanel({ event, children }: { event: EventStatusView; children?: ReactNode }) {
  const [status, setStatus] = useState(event.status);
  // SCRUM-127/AC2: the status before the latest change, so a rejection or cancellation made here lands on the right stage
  const [previousStatus, setPreviousStatus] = useState(event.previous_status);
  const [newStatus, setNewStatus] = useState(event.status);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string }>();
  const [saving, setSaving] = useState(false);

  function showStatus(saved: string) {
    setPreviousStatus(status);
    setStatus(saved);
    setNewStatus(saved);
    setMessage({ kind: "ok", text: `Status updated to ${statusLabel(saved)}.` });
  }

  async function save(target: string, why: string) {
    setMessage(undefined);
    setSaving(true);
    const { ok, data } = await changeEventStatus(event.id, target, why);
    if (ok) {
      showStatus(data.status);
      setReason("");
    } else {
      setMessage({ kind: "error", text: data.error ?? "We couldn't update the status. Please try again." });
    }
    setSaving(false);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    return save(newStatus, reason);
  }

  const showStartReview = event.canChangeStatus && canStartReview(status);
  // SCRUM-32/AC3: the assigned coordinator can request a venue once the event is approved (32-S2, 32-S3).
  const showVenueLink = event.canChangeStatus && canRequestVenue(status);

  return (
    <div className="event-panel">
      <header className="event-header">
        <h1>{event.name}</h1>
        <p className="event__status">
          Status <EventStatusBadge status={status} />
        </p>
      </header>

      <div className="mb-4">
        <StatusStepper status={status} hasCoordinator={Boolean(event.point_of_contact_name)} previousStatus={previousStatus} />
      </div>

      {message && (
        <div className={`alert alert--${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </div>
      )}

      {(showStartReview || showVenueLink) && (
        <div className="event-buttons">
          {/* SCRUM-45/AC1, AC3, AC5: only the assigned coordinator, and only while the request is submitted. */}
          {showStartReview && (
            <button className="btn" type="button" disabled={saving} onClick={() => save("under_review", "")}>
              {saving ? "Starting…" : "Start review"}
            </button>
          )}
          {showVenueLink && (
            <Link className="btn btn--secondary" href={`/events/${event.id}/venue-request`}>Request a venue</Link>
          )}
        </div>
      )}
      {event.canChangeStatus && !canRequestVenue(status) && (
        <p className="field__hint">{VENUE_BOOKING_MESSAGES.EVENT_NOT_ELIGIBLE}</p>
      )}

      <EventReviewActions eventId={event.id} status={status} canReview={event.canReview} onDecided={showStatus} />

      {children}

      {/* SCRUM-8: manual status change, kept last so the request reads first */}
      {event.canChangeStatus && (
        <section className="event-section" aria-labelledby="change-status-heading">
          <h2 id="change-status-heading">Change status</h2>
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
            <div className="event-buttons">
              <button className="btn" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
