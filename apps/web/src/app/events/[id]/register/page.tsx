import type { Metadata } from "next";
import Link from "next/link";
import { EventRegistrationForm } from "@/components/EventRegistrationForm";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { getRegistrationForm } from "@/lib/eventRegistrationServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Register for an event · ConnectSphere" };

// SCRUM-83: an attendee registers for an upcoming event (from Register on its List of events card)
export default async function RegisterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getRegistrationForm(id);

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href="/dashboard/attendee">← Back to events</Link>
        {"data" in result ? (
          <EventRegistrationForm data={result.data} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
