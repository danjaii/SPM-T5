"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { leadChangeCoordinator } from "@/lib/lead";
import type { LeadCoordinator } from "@/lib/leadServer";

interface Props {
  /** SCRUM-78 assigns an unassigned event; SCRUM-79 reassigns an assigned one. */
  mode?: "assign" | "reassign";
  eventId: string;
  eventName: string;
  /** The Lead's eligible coordinators; for a reassignment, without the current one (SCRUM-79/AC2). */
  coordinators: LeadCoordinator[];
  /** The coordinator a reassignment takes the event from; they are told too (SCRUM-126/AC3). */
  currentName?: string;
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

/** SCRUM-78/AC1, SCRUM-79/AC2, SCRUM-126/AC2: a coordinator's current workload. */
const workloadText = (c: LeadCoordinator) => `${c.workload} active ${c.workload === 1 ? "event" : "events"}`;

// The Lead picks one of their eligible coordinators, each shown with their workload (SCRUM-78/AC1, SCRUM-79/AC2), then
// confirms (SCRUM-78/AC2-AC3, SCRUM-79/AC3) or cancels, which sends nothing (SCRUM-78/AC8, SCRUM-79/AC7). event-service
// and the database decide whether the change stands (SCRUM-78/AC5, AC7, AC9; SCRUM-79/AC5, AC6, AC9).
export function LeadAssignForm({ mode = "assign", eventId, eventName, coordinators, currentName, cancelHref = "/lead/queue" }: Props) {
  const text = TEXT[mode];
  const [choice, setChoice] = useState<string | null>(null);
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
        <p className="alert alert--success" role="status">
          {eventName} is now assigned to {assignedTo}.{" "}
          {/* SCRUM-126/AC3: event-service's trigger notifies the new coordinator and, on a reassignment, the previous one */}
          {currentName ? `${assignedTo} and ${currentName} have been notified.` : `${assignedTo} has been notified.`}
        </p>
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
        <label id="coordinator-label">Event Coordinator</label>
        <Select value={choice} onValueChange={setChoice}>
          <SelectTrigger aria-labelledby="coordinator-label" className="w-full">
            <SelectValue placeholder="Select a coordinator">
              {(value: string | null) => coordinators.find((c) => c.id === value)?.full_name ?? "Select a coordinator"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {coordinators.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <span className="flex flex-col">
                  <span className="font-medium">{c.full_name}</span>
                  <span className="text-xs text-muted-foreground">{workloadText(c)}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="field__hint">Active events is each coordinator&apos;s current workload.</p>
      </div>
      <div className="event-buttons">
        <Button type="button" disabled={!choice || busy} onClick={confirm}>
          {busy ? text.busy : text.confirm}
        </Button>
        <Link className={buttonVariants({ variant: "secondary" })} href={cancelHref}>Cancel</Link>
      </div>
    </>
  );
}
