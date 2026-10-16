import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
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
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href="/safety-checks">← Back to events waiting for a safety check</Link>
        {"details" in result ? (
          <>
            <h1>Safety check: {result.details.name}</h1>
            <SafetyCheckInfo details={result.details} />
            {/* AC8: once decided, the record is shown instead of the choices (event-service would refuse a second one) */}
            {result.details.decisions.length > 0 ? (
              <SafetyDecisionHistory decisions={result.details.decisions} />
            ) : (
              <SafetyCheckActions eventId={id} role="safety_officer" />
            )}
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
