"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { EVENT_STATUSES, VENUE_BOOKING_MESSAGES, canRequestVenue, canStartReview, type EventStatus } from "@spm-t5/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { changeEventStatus, statusLabel, type EventStatusView } from "@/lib/events";
import { EVENT_STATUS_DISPLAY } from "@/lib/status";
import { EventReviewActions } from "./EventReviewActions";

// SCRUM-6/7: shows an event's current status. SCRUM-8: the assigned coordinator can also change it.
// SCRUM-45: the assigned coordinator starts the review. SCRUM-24: they also approve or reject it.
export function EventStatusPanel({ event, children }: { event: EventStatusView; children?: ReactNode }) {
  const [status, setStatus] = useState(event.status);
  const [newStatus, setNewStatus] = useState(event.status);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string }>();
  const [saving, setSaving] = useState(false);

  function showStatus(saved: string) {
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
      {/* SCRUM-125/AC1: the review actions sit beside the name and status, as in the Figma event page. AC6: StatusBadge. */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold break-words">{event.name}</h1>
          <StatusBadge {...(EVENT_STATUS_DISPLAY[status as EventStatus] ?? { label: statusLabel(status) })} />
        </div>
        <EventReviewActions eventId={event.id} status={status} canReview={event.canReview} onDecided={showStatus} />
      </header>

      {message && (
        <div className={`alert alert--${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </div>
      )}

      {(showStartReview || showVenueLink) && (
        <div className="event-buttons">
          {/* SCRUM-45/AC1, AC3, AC5: only the assigned coordinator, and only while the request is submitted. */}
          {showStartReview && (
            <Button disabled={saving} onClick={() => save("under_review", "")}>
              {saving ? "Starting…" : "Start review"}
            </Button>
          )}
          {showVenueLink && (
            <Link className={buttonVariants({ variant: "outline" })} href={`/events/${event.id}/venue-request`}>Request a venue</Link>
          )}
        </div>
      )}
      {event.canChangeStatus && !canRequestVenue(status) && (
        <p className="field__hint">{VENUE_BOOKING_MESSAGES.EVENT_NOT_ELIGIBLE}</p>
      )}

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
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
