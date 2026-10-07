"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  assignCoordinator,
  fetchAssignmentHistory,
  fetchEligibleCoordinators,
  type AssignmentRecord,
  type CoordinatorOption,
} from "@/lib/events";

// SCRUM-42/AC7, SCRUM-41/AC8: shown instead of a choice when nobody can take the event.
export const NO_ELIGIBLE = "No eligible coordinator is currently available.";

// SCRUM-43: no recorded changes. Not "nobody assigned": an event can have a coordinator from before logging began.
export const NO_HISTORY = "No assignment changes have been recorded.";

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" });

type Step =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "choose"; options: CoordinatorOption[] }
  | { kind: "none" };

interface Props {
  eventId: string;
  coordinatorName: string | null;
  canAssign: boolean;
}

// SCRUM-42: any coordinator claims an unassigned event for themselves. SCRUM-41: the assigned coordinator hands
// it to another. SCRUM-43: who has had it, oldest first. event-service decides canAssign and enforces both rules.
export function CoordinatorAssignment({ eventId, coordinatorName, canAssign }: Props) {
  const router = useRouter();
  const [current, setCurrent] = useState(coordinatorName);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [history, setHistory] = useState<AssignmentRecord[]>();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    fetchAssignmentHistory(eventId).then(({ ok, data }) => {
      if (live) setHistory(ok ? data : []);
    });
    return () => {
      live = false;
    };
  }, [eventId, reload]);

  // SCRUM-42/AC1: list who could take the event; AC7 when there's nobody
  async function start() {
    setError(undefined);
    setStep({ kind: "loading" });
    const { ok, data } = await fetchEligibleCoordinators(eventId);
    if (!ok) {
      setError(data.error ?? "We couldn't load the coordinators. Please try again.");
      setStep({ kind: "idle" });
    } else if (data.length === 0) {
      setStep({ kind: "none" });
    } else {
      setChoice(data[0].id);
      setStep({ kind: "choose", options: data });
    }
  }

  // SCRUM-42/AC3, SCRUM-41/AC3: confirm the selection
  async function confirm(options: CoordinatorOption[]) {
    setBusy(true);
    setError(undefined);
    const { ok, data } = await assignCoordinator(eventId, choice);
    if (ok) {
      setCurrent(options.find((o) => o.id === choice)?.full_name ?? null);
      setStep({ kind: "idle" });
      setReload((n) => n + 1);
      router.refresh(); // who may start review / decide depends on who is assigned
    } else {
      setError(data.error ?? "We couldn't assign the coordinator. Please try again.");
    }
    setBusy(false);
  }

  const action = current ? "Reassign coordinator" : "Assign to me";

  return (
    <>
      <section className="event-section" aria-labelledby="coordinator-heading">
        <h2 id="coordinator-heading">Coordinator</h2>
        {error && <div className="alert alert--error" role="alert">{error}</div>}

        <div className="event-detail-card">
          <div className="event-coordinator">
            <p className="event-coordinator__name">
              {current ?? <span className="event__missing">Not yet assigned</span>}
            </p>
            {canAssign && (step.kind === "idle" || step.kind === "loading") && (
              <button className="btn btn--secondary" type="button" disabled={step.kind === "loading"} onClick={start}>
                {step.kind === "loading" ? "Loading…" : action}
              </button>
            )}
          </div>

          {step.kind === "none" && (
            <div className="event-detail-card__step">
              <p className="alert alert--info" role="status">{NO_ELIGIBLE}</p>
              <div className="event-buttons">
                <button className="btn btn--secondary" type="button" onClick={() => setStep({ kind: "idle" })}>
                  Close
                </button>
              </div>
            </div>
          )}

          {step.kind === "choose" && (
            <div className="event-detail-card__step">
              {current ? (
                <div className="field">
                  <label htmlFor="coordinator-choice">New coordinator</label>
                  <select id="coordinator-choice" value={choice} onChange={(e) => setChoice(e.target.value)}>
                    {step.options.map((o) => (
                      <option key={o.id} value={o.id}>{o.full_name ?? "Unnamed coordinator"}</option>
                    ))}
                  </select>
                </div>
              ) : (
                // SCRUM-42: an unassigned event can only be claimed, so event-service offers just the caller
                <p>Assign this event to yourself? You become the organiser&apos;s point of contact.</p>
              )}
              <div className="event-buttons">
                <button className="btn" type="button" disabled={busy} onClick={() => confirm(step.options)}>
                  {busy ? "Assigning…" : "Confirm assignment"}
                </button>
                <button className="btn btn--secondary" type="button" disabled={busy} onClick={() => setStep({ kind: "idle" })}>
                  Cancel
                </button>
              </div>
            </div>
          )}
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
