import type { Metadata } from "next";
import Link from "next/link";
import { LeadCoordinatorEvents } from "@/components/LeadCoordinatorEvents";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { getCoordinatorEvents, getLeadCoordinators } from "@/lib/leadServer";

// SCRUM-81/AC5: loaded per request, so opening or refreshing shows the current assignments
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Coordinator's active events · ConnectSphere" };

// SCRUM-81/AC2: one coordinator's non-closed events, opened from the coordinator overview.
export default async function CoordinatorEventsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [result, overview] = await Promise.all([getCoordinatorEvents(id), getLeadCoordinators()]);
  const coordinator = "coordinators" in overview ? overview.coordinators.find((c) => c.id === id) : undefined;

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href="/lead/coordinators">← Back to coordinator overview</Link>
        <h1>{coordinator ? `${coordinator.full_name}'s active events` : "Coordinator's active events"}</h1>
        {"events" in result ? (
          <LeadCoordinatorEvents events={result.events} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
