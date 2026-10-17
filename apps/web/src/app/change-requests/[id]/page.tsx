import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { ChangeRequestReview } from "@/components/ChangeRequestReview";
import { getChangeRequestReview } from "@/lib/changeRequestReviewServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Review change request · ConnectSphere" };

// SCRUM-67: the event's coordinator reviews a change request. Anyone else gets event-service's refusal (AC7).
export default async function ChangeRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getChangeRequestReview(id);

  return (
    <>
      <AppHeader />
      <main className="dash__main">
        {"review" in result ? (
          <>
            <Link className="back-link" href={`/events/${result.review.eventId}`}>← Back to event</Link>
            <ChangeRequestReview review={result.review} />
          </>
        ) : (
          <>
            <Link className="back-link" href="/dashboard">← Back to dashboard</Link>
            <div className="alert alert--error" role="alert">{result.error}</div>
          </>
        )}
      </main>
    </>
  );
}
