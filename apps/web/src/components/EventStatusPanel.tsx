"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { EVENT_STATUSES, VENUE_BOOKING_MESSAGES, canRequestVenue, canStartReview, isClosedEventStatus, type EventStatus } from "@spm-t5/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { changeEventStatus, statusLabel, type EventStatusView } from "@/lib/events";
import { EVENT_STATUS_DISPLAY } from "@/lib/status";
import { EventReviewActions } from "./EventReviewActions";
import { EventSection } from "./event/EventSection";
import { EventTabs, type EventTabId } from "./event/EventTabs";
import { InlineMessage } from "./event/InlineMessage";
import { StatusStepper } from "./event/StatusStepper";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";

/** The statuses that need a reason: what to say when it is missing, and who will be told it. */
const REASON_REQUIRED: Partial<Record<string, { missing: string; toldTo: string }>> = {
  cancelled: { missing: "A reason is required to cancel an event.", toldTo: "The organiser and registered attendees will be told this reason." },
  rejected: { missing: "A reason is required to reject an event.", toldTo: "The organiser will be told this reason." },
};

// SCRUM-6/7: shows an event's current status. SCRUM-8: the assigned coordinator can also change it.
// SCRUM-45: the assigned coordinator starts the review. SCRUM-24: they also approve or reject it.
/** SCRUM-127: `activeTab` is the page's tab (the review actions and Change status belong to the overview), `meta` the line under the title. */
export function EventStatusPanel({ event, activeTab = "overview", meta, notice, children }: { event: EventStatusView; activeTab?: EventTabId; meta?: string; notice?: ReactNode; children?: ReactNode }) {
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

  // SCRUM-174/AC1: a cancellation needs a reason, because the organiser and attendees are told it (AC6). SCRUM-47/AC10:
  // so does a rejection, which the organiser is told. event-service refuses both without one, with the same words.
  const reasonRule = REASON_REQUIRED[newStatus];

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (reasonRule && !reason.trim()) {
      setMessage({ kind: "error", text: reasonRule.missing });
      return;
    }
    return save(newStatus, reason);
  }

  // SCRUM-174/AC1: an event that is already over (completed, rejected) cannot be cancelled; the database refuses it too
  const statusChoices = EVENT_STATUSES.filter((s) => s !== "cancelled" || !isClosedEventStatus(status));

  const showStartReview = event.canChangeStatus && canStartReview(status);
  // SCRUM-32/AC3: the assigned coordinator can request a venue once the event is approved (32-S2, 32-S3).
  const showVenueLink = event.canChangeStatus && canRequestVenue(status);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold break-words">{event.name}</h1>
            <StatusBadge {...(EVENT_STATUS_DISPLAY[status as EventStatus] ?? { label: statusLabel(status) })} />
          </div>
          {meta && <p className="text-sm text-muted-foreground">{meta}</p>}
        </div>
        {(showStartReview || showVenueLink || event.canReview) && (
          <div className="flex flex-wrap gap-3">
            {/* SCRUM-125/AC1: the review actions sit beside the name and status; each opens a dialog. */}
            <EventReviewActions eventId={event.id} status={status} canReview={event.canReview} onDecided={showStatus} />
            {/* SCRUM-45/AC1, AC3, AC5: only the assigned coordinator, and only while the request is submitted. */}
            {showStartReview && (
              <Button type="button" disabled={saving} onClick={() => save("under_review", "")}>
                {saving ? "Starting…" : "Start review"}
              </Button>
            )}
            {showVenueLink && (
              <>
                <Link className={cn(buttonVariants({ variant: "outline" }))} href={`/venues?eventId=${event.id}`}>Find a venue</Link>
                <Link className={cn(buttonVariants({ variant: "outline" }))} href={`/events/${event.id}/venue-request`}>Request a venue</Link>
              </>
            )}
          </div>
        )}
      </header>

      {/* SCRUM-135: a venue booking that needs attention is said at the top of every tab */}
      {notice}

      <StatusStepper status={status} hasCoordinator={Boolean(event.point_of_contact_name)} previousStatus={previousStatus} />

      <EventTabs basePath={`/events/${event.id}`} activeTab={activeTab} />

      {message && <InlineMessage kind={message.kind}>{message.text}</InlineMessage>}

      {activeTab === "venues" && event.canChangeStatus && !canRequestVenue(status) && (
        <p className="text-sm text-muted-foreground">{VENUE_BOOKING_MESSAGES.EVENT_NOT_ELIGIBLE}</p>
      )}

      {children}

      {/* SCRUM-174/AC7: a cancelled event stays cancelled (migration 64), so there is nothing to change */}
      {activeTab === "overview" && event.canChangeStatus && status === "cancelled" && (
        <p className="text-sm text-muted-foreground">This event was cancelled, so its status can no longer change.</p>
      )}

      {/* SCRUM-8: manual status change, kept last so the request reads first */}
      {activeTab === "overview" && event.canChangeStatus && status !== "cancelled" && (
        <EventSection id="change-status-heading" title="Change status">
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="new-status" className="text-sm font-semibold">New status</label>
              <select
                id="new-status"
                className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring"
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
              >
                {statusChoices.map((s) => (
                  <option key={s} value={s}>{statusLabel(s)}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="reason" className="text-sm font-semibold">{reasonRule ? "Reason (required)" : "Reason (optional)"}</label>
              <Textarea
                id="reason"
                rows={3}
                value={reason}
                required={Boolean(reasonRule)}
                aria-describedby={reasonRule ? "reason-helper" : undefined}
                onChange={(e) => setReason(e.target.value)}
              />
              {reasonRule && <p id="reason-helper" className="text-sm text-muted-foreground">{reasonRule.toldTo}</p>}
            </div>
            <Button className="self-start" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </form>
        </EventSection>
      )}
    </div>
  );
}
