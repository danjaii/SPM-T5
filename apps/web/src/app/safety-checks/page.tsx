import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { SafetyCheckQueue } from "@/components/SafetyCheckQueue";
import { getSafetyQueue } from "@/lib/safetyCheckServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Events waiting for a safety check · ConnectSphere" };

// SCRUM-99/AC2: the Safety Officer's list of events ready for an Operational Safety Check.
export default async function SafetyCheckQueuePage() {
  const result = await getSafetyQueue();

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href="/dashboard/safety_officer">← Back to dashboard</Link>
        <h1>Events waiting for a safety check</h1>
        {"events" in result ? (
          <SafetyCheckQueue events={result.events} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
