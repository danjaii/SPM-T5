import type { Metadata } from "next";
import Link from "next/link";
import { LeadCoordinatorList } from "@/components/LeadCoordinatorList";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { getLeadCoordinators } from "@/lib/leadServer";

// SCRUM-81/AC5: loaded per request, so opening or refreshing shows the current assignments
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Coordinator overview · ConnectSphere" };

// SCRUM-81: the coordinators the Lead supervises, with their workload.
export default async function CoordinatorOverviewPage() {
  const result = await getLeadCoordinators();

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href="/dashboard/event_coordinator_lead">← Back to dashboard</Link>
        <h1>Coordinator overview</h1>
        {"coordinators" in result ? (
          <LeadCoordinatorList coordinators={result.coordinators} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
