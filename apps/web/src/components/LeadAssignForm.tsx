"use client";

import Link from "next/link";
import { useState } from "react";
import { leadChangeCoordinator } from "@/lib/lead";
import type { LeadCoordinator } from "@/lib/leadServer";

interface Props {
  /** SCRUM-78 assigns an unassigned event; SCRUM-79 reassigns an assigned one. */
  mode?: "assign" | "reassign";
  eventId: string;
  eventName: string;
  /** Reassign only: who has the event now (SCRUM-79/AC2). */
  current?: { id: string; full_name: string | null };
  /** The Lead's eligible coordinators; for a reassignment, without the current one (SCRUM-79/AC2). */
  coordinators: LeadCoordinator[];
  /** Where Cancel goes (SCRUM-78/AC8, SCRUM-79/AC7). */
  cancelHref?: string;
}

const TEXT = {
  assign: {
    none: "No eligible coordinators are available.",
    confirm: "Confirm assignment",
    busy: "Assigning…",
    failed: "We couldn't assign the coordinator. Please try again.",
    back: { href: "/lead/queue", label: "Back to unassigned event requests" },
  },
  reassign: {
    none: "No other eligible coordinators are available.",
    confirm: "Confirm reassignment",
    busy: "Reassigning…",
    failed: "We couldn't reassign the coordinator. Please try again.",
    back: { href: "/lead/coordinators", label: "Back to coordinator overview" },
  },
};

// The Lead picks one of their eligible coordinators, each shown with their workload (SCRUM-78/AC1, SCRUM-79/AC2), then
// confirms (SCRUM-78/AC2-AC3, SCRUM-79/AC3) or cancels, which sends nothing (SCRUM-78/AC8, SCRUM-79/AC7). event-service
// and the database decide whether the change stands (SCRUM-78/AC5, AC7, AC9; SCRUM-79/AC5, AC6, AC9).
export function LeadAssignForm({ mode = "assign", eventId, eventName, current, coordinators, cancelHref = "/lead/queue" }: Props) {
  const text = TEXT[mode];
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [assignedTo, setAssignedTo] = useState<string>();

  const currently = current && <p>Currently assigned to {current.full_name ?? "an unnamed coordinator"}</p>;

  // SCRUM-78/AC7, SCRUM-79/AC6: nobody to choose, so nothing to confirm
  if (coordinators.length === 0) {
    return (
      <>
        {currently}
        <p className="alert alert--info" role="status">{text.none}</p>
      </>
    );
  }

  // SCRUM-78/AC3, SCRUM-79/AC3: done; the event now shows as assigned to the chosen coordinator
  if (assignedTo) {
    return (
      <>
        <p className="alert alert--success" role="status">{eventName} is now assigned to {assignedTo}.</p>
        <Link href={text.back.href}>{text.back.label}</Link>
      </>
    );
  }

  async function confirm() {
    if (!choice) return;
    setBusy(true);
    setError(undefined);
    const { ok, data } = await leadChangeCoordinator(mode, eventId, choice);
    if (ok) setAssignedTo(coordinators.find((c) => c.id === choice)?.full_name);
    else setError(data.error ?? text.failed);
    setBusy(false);
  }

  return (
    <>
      {currently}
      {error && <div className="alert alert--error" role="alert">{error}</div>}
      <fieldset className="roles">
        <legend className="legend">Choose an Event Coordinator</legend>
        {coordinators.map((c) => (
          <label key={c.id} className="role-option" data-selected={choice === c.id}>
            <input type="radio" name="coordinator" value={c.id} checked={choice === c.id} onChange={() => setChoice(c.id)} />
            {c.full_name} ({c.workload} active events)
          </label>
        ))}
      </fieldset>
      <div className="event-buttons">
        <button className="btn" type="button" disabled={!choice || busy} onClick={confirm}>
          {busy ? text.busy : text.confirm}
        </button>
        <Link className="btn btn--secondary" href={cancelHref}>Cancel</Link>
      </div>
    </>
  );
}
