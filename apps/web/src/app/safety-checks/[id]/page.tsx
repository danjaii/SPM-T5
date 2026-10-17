import type { Metadata } from "next";
import Link from "next/link";
import { awaitsSafetyDecision, type SafetyDecision } from "@spm-t5/shared";
import { AppHeader } from "@/components/AppHeader";
import { SafetyCheckActions } from "@/components/SafetyCheckActions";
import { SafetyCheckInfo } from "@/components/SafetyCheckInfo";
import { SafetyDecisionHistory } from "@/components/SafetyDecisionHistory";
import { getSafetyCheck } from "@/lib/safetyCheckServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Safety check · ConnectSphere" };

// SCRUM-99: the Safety Officer reviews one event (AC3) and records the outcome (AC4-AC6, AC8), opened from the queue.
// event-service gives the safety information to Safety Officers only, so the decision is offered to the Safety Officer.
export default async function SafetyCheckReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getSafetyCheck(id);

  return (
    <>
      <AppHeader />
      <main className="dash__main">
        <Link className="back-link" href="/safety-checks">← Back to events waiting for a safety check</Link>
        {"details" in result ? (
          <>
            <h1>Safety check: {result.details.name}</h1>
            <SafetyCheckInfo details={result.details} />
            {/* AC8: the decisions recorded so far (newest first) */}
            {result.details.decisions.length > 0 && <SafetyDecisionHistory decisions={result.details.decisions} />}
            {/* AC4: the choices, only while a decision can be saved (SCRUM-100/AC6: again after changes were requested) */}
            {awaitsSafetyDecision(
              result.details.status,
              // SCRUM-100/AC9: the newest decision that still applies, as latest_safety_decision() counts them
              (result.details.decisions.find((d) => !d.revoked_at)?.decision as SafetyDecision | undefined) ?? null,
            ) && <SafetyCheckActions eventId={id} role="safety_officer" />}
          </>
        ) : (
          <>
            <h1>Safety check</h1>
            <div className="alert alert--error" role="alert">{result.error}</div>
          </>
        )}
      </main>
    </>
  );
}
