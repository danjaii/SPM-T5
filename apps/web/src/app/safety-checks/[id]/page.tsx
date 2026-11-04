import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Clock } from "lucide-react";
import { awaitsSafetyDecision, type SafetyDecision } from "@spm-t5/shared";
import { AuthAlert } from "@/components/auth/AuthParts";
import { SafetyCheckReview } from "@/components/SafetyCheckReview";
import { SafetyDecisionHistory } from "@/components/SafetyDecisionHistory";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatEventDateTime } from "@/lib/formatEventDateTime";
import { getSafetyCheck } from "@/lib/safetyCheckServer";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Safety check · ConnectSphere" };

const Breadcrumb = ({ current }: { current?: string }) => (
  <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground">
    <Link href="/safety-checks" className="underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring">Safety checks</Link>
    {current && (
      <>
        <ChevronRight aria-hidden="true" className="size-4" />
        <span aria-current="page" className="font-semibold text-foreground">{current}</span>
      </>
    )}
  </nav>
);

// SCRUM-99: the Safety Officer reviews one event (AC3) and records the outcome (AC4-AC6, AC8), opened from the queue.
// event-service gives the safety information to Safety Officers only, so the decision is offered to the Safety Officer.
// SCRUM-142 (Figma frame 13): inside the shared app shell, as a checklist beside the decision.
export default async function SafetyCheckReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getSafetyCheck(id);

  if (!("details" in result)) {
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 md:px-8">
        <Breadcrumb />
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Safety check</h1>
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
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
      <Breadcrumb current={details.name} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Operational safety check</h1>
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
