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

/** One dropdown option: the coordinator and their workload (SCRUM-78/AC1, SCRUM-79/AC2). */
function coordinatorOption(c: LeadCoordinator) {
  return `${c.full_name} — ${c.workload} active ${c.workload === 1 ? "event" : "events"}`;
}

// The Lead picks one of their eligible coordinators, each shown with their workload (SCRUM-78/AC1, SCRUM-79/AC2), then
// confirms (SCRUM-78/AC2-AC3, SCRUM-79/AC3) or cancels, which sends nothing (SCRUM-78/AC8, SCRUM-79/AC7). event-service
// and the database decide whether the change stands (SCRUM-78/AC5, AC7, AC9; SCRUM-79/AC5, AC6, AC9).
export function LeadAssignForm({ mode = "assign", eventId, eventName, coordinators, cancelHref = "/lead/queue" }: Props) {
  const text = TEXT[mode];
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [assignedTo, setAssignedTo] = useState<string>();

  // SCRUM-78/AC7, SCRUM-79/AC6: nobody to choose, so nothing to confirm
  if (coordinators.length === 0) {
    return <p className="alert alert--info" role="status">{text.none}</p>;
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
      {error && <div className="alert alert--error" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="coordinator">Event Coordinator</label>
        <select id="coordinator" value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="" disabled>Select a coordinator</option>
          {coordinators.map((c) => (
            <option key={c.id} value={c.id}>{coordinatorOption(c)}</option>
          ))}
        </select>
        <p className="field__hint">Active events is each coordinator&apos;s current workload.</p>
      </div>
      <div className="event-buttons">
        <button className="btn" type="button" disabled={!choice || busy} onClick={confirm}>
          {busy ? text.busy : text.confirm}
        </button>
        <Link className="btn btn--secondary" href={cancelHref}>Cancel</Link>
      </div>
    </>
  );
}
