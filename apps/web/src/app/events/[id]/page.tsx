import type { Metadata } from "next";
import Link from "next/link";
import { EventStatusPanel } from "@/components/EventStatusPanel";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { getEvent } from "@/lib/getEvent";

// Rendered per request: what's shown depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Event status · ConnectSphere" };

// SCRUM-6/7/8: view an event's status; the assigned coordinator can also change it.
export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getEvent(id);

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href="/dashboard">← Back to dashboard</Link>
        {"event" in result ? (
          <EventStatusPanel event={result.event} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
