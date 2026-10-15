"use client";

import { useState } from "react";
import { SuitabilityReport } from "./SuitabilityReport";
import { checkVenueSuitability, type SuitabilityView } from "@/lib/venueSuitability";

interface Props {
  eventId: string;
  /** What is typed in the request form right now; the check runs on this, not on what was saved. */
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
  /** SCRUM-110/AC6: this booking's own attendance and layout (SCRUM-98); left out, the event's are used. */
  attendance?: number;
  venueRequirements?: string;
  run?: typeof checkVenueSuitability;
}

// SCRUM-109: "Check suitability" on the venue request form. Information only: it never blocks the request.
export function SuitabilityCheck({ eventId, venueId, date, startTime, endTime, attendance, venueRequirements, run = checkVenueSuitability }: Props) {
  const [report, setReport] = useState<SuitabilityView>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function check() {
    setReport(undefined);
    if (!venueId) {
      setError("Choose a venue to check.");
      return;
    }
    setError(undefined);
    setBusy(true);
    const { ok, data } = await run({ venueId, eventId, date, startTime, endTime, attendance, venueRequirements });
    if (ok) setReport(data);
    else setError(Object.values(data.fieldErrors ?? {})[0] ?? data.error ?? "We couldn't check this venue. Please try again.");
    setBusy(false);
  }

  return (
    <div className="suitability-check">
      <button className="btn btn--secondary" type="button" onClick={check} disabled={busy}>
        {busy ? "Checking…" : "Check suitability"}
      </button>
      {error && <div className="alert alert--error" role="alert">{error}</div>}
      {report && <SuitabilityReport report={report} />}
    </div>
  );
}
