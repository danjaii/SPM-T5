import type { Metadata } from "next";
import Link from "next/link";
import { Clock } from "lucide-react";
import { awaitsSafetyDecision, type SafetyDecision } from "@spm-t5/shared";
import { AuthAlert } from "@/components/auth/AuthParts";
import { SafetyCheckReview } from "@/components/SafetyCheckReview";
import { SafetyDecisionHistory } from "@/components/SafetyDecisionHistory";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatEventDateTime } from "@/lib/formatEventDateTime";
import { getSafetyCheck } from "@/lib/safetyCheckServer";
import { cn } from "@/lib/utils";
import { BackLink, PAGE_MAIN, PageTitle } from "@/components/PageFrame";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Safety check · ConnectSphere" };

// SCRUM-99: the Safety Officer reviews one event (AC3) and records the outcome (AC4-AC6, AC8), opened from the queue.
// event-service gives the safety information to Safety Officers only, so the decision is offered to the Safety Officer.
// SCRUM-142 (Figma frame 13): inside the shared app shell, as a checklist beside the decision.
// SCRUM-186/AC3: the shared back link replaces the breadcrumb, as on every other page reached from a list.
export default async function SafetyCheckReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getSafetyCheck(id);

  if (!("details" in result)) {
    return (
      <main className={PAGE_MAIN}>
        <BackLink href="/safety-checks" to="safety checks" />
        <PageTitle>Safety check</PageTitle>
        <AuthAlert tone="error">{result.error}</AuthAlert>
      </main>
    );
  }

  const { details } = result;
  // SCRUM-100/AC6 + AC9: a decision can be saved while the event awaits one, judged on the newest decision that still applies
  const canDecide = awaitsSafetyDecision(
    details.status,
    (details.decisions.find((d) => !d.revoked_at)?.decision as SafetyDecision | undefined) ?? null,
  );
  const when = details.preferred_start_datetime ? formatEventDateTime(details.preferred_start_datetime, details.preferred_end_datetime) : null;
  const summary = [
    details.name,
    when,
    details.expected_attendance !== null
      ? `${details.expected_attendance} people across ${details.venues.length} ${details.venues.length === 1 ? "space" : "spaces"}`
      : null,
  ].filter(Boolean).join(" · ");

  return (
    <main className={PAGE_MAIN}>
      <BackLink href="/safety-checks" to="safety checks" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <PageTitle>Operational safety check</PageTitle>
            <StatusBadge tone="info" label="Safety check" />
          </div>
          <p className="text-sm text-muted-foreground">{summary}</p>
        </div>
        <Link href={`/events/${encodeURIComponent(id)}`} className={cn(buttonVariants({ variant: "outline" }))}>Open event page</Link>
      </div>

      {canDecide && (
        <div className="flex items-start gap-3 rounded-lg border border-status-info-fg bg-status-info p-4 text-sm text-status-info-fg">
          <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-bold">Venues and equipment are confirmed</p>
            <p>The event cannot move to preparation until you approve. Rejecting it or requesting changes sends it back to Planning.</p>
          </div>
        </div>
      )}

      <SafetyCheckReview details={details} canDecide={canDecide} />
      {/* AC8: the decisions recorded so far (newest first) */}
      {details.decisions.length > 0 && <SafetyDecisionHistory decisions={details.decisions} />}
    </main>
  );
}
