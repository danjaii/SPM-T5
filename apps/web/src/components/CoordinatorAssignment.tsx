"use client";

import { useEffect, useState } from "react";
import { EmptyNote, EventSection } from "@/components/event/EventSection";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchAssignmentHistory, type AssignmentRecord } from "@/lib/events";

// SCRUM-43: no recorded changes. Not "nobody assigned": an event can have a coordinator from before logging began.
export const NO_HISTORY = "No assignment changes have been recorded.";

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" });

interface Props {
  eventId: string;
  coordinatorName: string | null;
}

// Who coordinates the event, and SCRUM-43: who has had it, oldest first. Assigning and reassigning are done by an Event
// Coordinator Lead from the Lead's pages (SCRUM-78, SCRUM-79), so this page offers no assign or reassign action.
export function CoordinatorAssignment({ eventId, coordinatorName }: Props) {
  const [history, setHistory] = useState<AssignmentRecord[]>();

  useEffect(() => {
    let live = true;
    fetchAssignmentHistory(eventId).then(({ ok, data }) => {
      if (live) setHistory(ok ? data : []);
    });
    return () => {
      live = false;
    };
  }, [eventId]);

  return (
    <>
      <EventSection id="coordinator-heading" title="Coordinator">
        <p className="text-sm font-semibold">
          {coordinatorName ?? <span className="font-normal text-muted-foreground">Not yet assigned</span>}
        </p>
      </EventSection>

      <EventSection id="history-heading" title="Assignment history">
        {history === undefined ? (
          <EmptyNote role="status">Loading history…</EmptyNote>
        ) : history.length === 0 ? (
          <EmptyNote>{NO_HISTORY}</EmptyNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Assigned to</TableHead>
                <TableHead>Previously</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((h) => (
                <TableRow key={`${h.assigned_at}-${h.coordinator_id}`}>
                  <TableCell>{formatDateTime(h.assigned_at)}</TableCell>
                  <TableCell>{h.coordinator_name ?? "—"}</TableCell>
                  <TableCell>{h.previous_coordinator_name ?? "—"}</TableCell>
                  <TableCell>{h.assigned_by_name ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </EventSection>
    </>
  );
}
