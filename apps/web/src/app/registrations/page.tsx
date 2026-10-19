import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { MyRegistrationList } from "@/components/MyRegistrationList";
import { getMyRegistrations } from "@/lib/eventRegistrationServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My registrations · ConnectSphere" };

// SCRUM-83/AC15: the attendee's "My registrations"
export default async function MyRegistrationsPage() {
  const result = await getMyRegistrations();

  return (
    <>
      <AppHeader />
      <main className="dash__main">
        <Link className="back-link" href="/dashboard/attendee">← Back to events</Link>
        <h1>My registrations</h1>
        {"registrations" in result ? (
          <MyRegistrationList registrations={result.registrations} />
        ) : (
          // Couldn't load: say so, rather than "You have not registered for an event" (SCRUM-72/AC5)
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
