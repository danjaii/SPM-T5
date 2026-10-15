"use client";

import { useEffect, useState } from "react";
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
      <section className="event-section" aria-labelledby="coordinator-heading">
        <h2 id="coordinator-heading">Coordinator</h2>
        <div className="event-detail-card">
          <div className="event-coordinator">
            <p className="event-coordinator__name">
              {coordinatorName ?? <span className="event__missing">Not yet assigned</span>}
            </p>
          </div>
        </div>
      </section>

      <section className="event-section" aria-labelledby="history-heading">
        <h2 id="history-heading">Assignment history</h2>
        {history === undefined ? (
          <p className="event-detail-card event-detail-card--quiet" role="status">Loading history…</p>
        ) : history.length === 0 ? (
          <p className="event-detail-card event-detail-card--quiet">{NO_HISTORY}</p>
        ) : (
          <div className="event-detail-card event-detail-card--table">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Assigned to</th>
                  <th>Previously</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={`${h.assigned_at}-${h.coordinator_id}`}>
                    <td>{formatDateTime(h.assigned_at)}</td>
                    <td>{h.coordinator_name ?? "—"}</td>
                    <td>{h.previous_coordinator_name ?? "—"}</td>
                    <td>{h.assigned_by_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
