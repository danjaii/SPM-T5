"use client";

import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";
import { CoordinatorChoiceList } from "@/components/CoordinatorChoiceList";
import { useShell } from "@/components/shell/ShellContext";
import { Button, buttonVariants } from "@/components/ui/button";
import { leadChangeCoordinator } from "@/lib/lead";
import type { LeadCoordinatorChoice } from "@/lib/leadServer";

interface Props {
  /** SCRUM-78 assigns an unassigned event; SCRUM-79 reassigns an assigned one. */
  mode?: "assign" | "reassign";
  eventId: string;
  eventName: string;
  /** The Lead's eligible coordinators; for a reassignment, without the current one (SCRUM-79/AC2). */
  coordinators: LeadCoordinatorChoice[];
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

const TONES = {
  info: { classes: "border-status-info-fg bg-status-info text-status-info-fg", icon: Info },
  success: { classes: "border-status-success-fg bg-status-success text-status-success-fg", icon: CircleCheck },
  danger: { classes: "border-status-danger-fg bg-status-danger text-status-danger-fg", icon: TriangleAlert },
};

/** A tinted message with an icon, so it is never told apart by colour alone. */
function Notice({ tone, role, children }: { tone: keyof typeof TONES; role: "status" | "alert"; children: ReactNode }) {
  const { classes, icon: Icon } = TONES[tone];
  return (
    <div role={role} className={`flex items-start gap-2 rounded-lg border p-4 text-sm ${classes}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

// The Lead picks one of their eligible coordinators, each shown with their workload and any clash with this event
// (SCRUM-78/AC1, SCRUM-79/AC2, SCRUM-168), then confirms (SCRUM-78/AC2-AC3, SCRUM-79/AC3) or cancels, which sends nothing
// (SCRUM-78/AC8, SCRUM-79/AC7). event-service and the database decide whether the change stands (SCRUM-78/AC5, AC7, AC9;
// SCRUM-79/AC5, AC6, AC9).
export function LeadAssignForm({ mode = "assign", eventId, eventName, coordinators, currentName, cancelHref = "/lead/queue" }: Props) {
  const text = TEXT[mode];
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [assignedTo, setAssignedTo] = useState<string>();
  const shell = useShell();

  // SCRUM-78/AC7, SCRUM-79/AC6: nobody to choose, so nothing to confirm
  if (coordinators.length === 0) {
    return <Notice tone="info" role="status">{text.none}</Notice>;
  }

  // SCRUM-78/AC3, SCRUM-79/AC3: done; the event now shows as assigned to the chosen coordinator
  if (assignedTo) {
    return (
      <div className="space-y-4">
        <Notice tone="success" role="status">
          {eventName} is now assigned to {assignedTo}.{" "}
          {/* SCRUM-126/AC3: event-service's trigger notifies the new coordinator and, on a reassignment, the previous one */}
          {currentName ? `${assignedTo} and ${currentName} have been notified.` : `${assignedTo} has been notified.`}
        </Notice>
        <Link className={buttonVariants({ variant: "outline" })} href={text.back.href}>{text.back.label}</Link>
      </div>
    );
  }

  async function confirm() {
    if (!choice) return;
    setBusy(true);
    setError(undefined);
    const { ok, data } = await leadChangeCoordinator(mode, eventId, choice);
    if (ok) {
      setAssignedTo(coordinators.find((c) => c.id === choice)?.full_name);
      // SCRUM-178/AC2: not router.refresh(), which would re-render the page without this form and lose the message above
      shell?.refreshCounts();
    } else setError(data.error ?? text.failed);
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      {error && <Notice tone="danger" role="alert">{error}</Notice>}
      <div className="space-y-2">
        <p id="coordinator-label" className="text-sm font-medium">Event Coordinator</p>
        <CoordinatorChoiceList coordinators={coordinators} value={choice} onChange={setChoice} labelledBy="coordinator-label" />
        <p className="text-xs text-muted-foreground">
          Clashes use each event&apos;s preferred date, which can still change. You can choose any coordinator.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!choice || busy} onClick={confirm}>
          {busy ? text.busy : text.confirm}
        </Button>
        <Link className={buttonVariants({ variant: "outline" })} href={cancelHref}>Cancel</Link>
      </div>
    </div>
  );
}
