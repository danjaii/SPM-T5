"use client";

import Link from "next/link";
import { useState } from "react";
import { leadAssign } from "@/lib/lead";
import type { LeadCoordinator } from "@/lib/leadServer";

interface Props {
  eventId: string;
  eventName: string;
  coordinators: LeadCoordinator[];
}

// SCRUM-78: the Lead picks one of their eligible coordinators (AC1), confirms (AC2, AC3) or cancels (AC8).
// event-service and the database decide whether the assignment stands (AC5, AC7, AC9).
export function LeadAssignForm({ eventId, eventName, coordinators }: Props) {
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [assignedTo, setAssignedTo] = useState<string>();

  // AC7: nobody to choose, so nothing to confirm
  if (coordinators.length === 0) return <p className="alert alert--info" role="status">No eligible coordinators are available.</p>;

  // AC3: done; the event now shows as assigned
  if (assignedTo) {
    return (
      <>
        <p className="alert alert--success" role="status">{eventName} is now assigned to {assignedTo}.</p>
        <Link href="/lead/queue">Back to unassigned event requests</Link>
      </>
    );
  }

  async function confirm() {
    if (!choice) return;
    setBusy(true);
    setError(undefined);
    const { ok, data } = await leadAssign(eventId, choice);
    if (ok) setAssignedTo(coordinators.find((c) => c.id === choice)?.full_name);
    else setError(data.error ?? "We couldn't assign the coordinator. Please try again.");
    setBusy(false);
  }

  return (
    <>
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
          {busy ? "Assigning…" : "Confirm assignment"}
        </button>
        <Link className="btn btn--secondary" href="/lead/queue">Cancel</Link>
      </div>
    </>
  );
}
