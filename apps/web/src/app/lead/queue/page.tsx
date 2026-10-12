import type { Metadata } from "next";
import Link from "next/link";
import { LeadQueueList } from "@/components/LeadQueueList";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { getLeadQueue } from "@/lib/leadServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Unassigned event requests · ConnectSphere" };

// SCRUM-77: the Lead's queue of event requests waiting for an Event Coordinator.
export default async function LeadQueuePage() {
  const result = await getLeadQueue();

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href="/dashboard/event_coordinator_lead">← Back to dashboard</Link>
        <h1>Unassigned event requests</h1>
        {"requests" in result ? (
          <LeadQueueList requests={result.requests} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
