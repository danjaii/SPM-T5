import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { MyEventRequestsTable } from "@/components/MyEventRequestsTable";
import { getMyEventRequests } from "@/lib/myEventRequestsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My event requests · ConnectSphere" };

// SCRUM-52: an organiser tracks every event request they created. event-service answers only for organisers and RLS limits the rows to theirs.
export default async function MyEventRequestsPage() {
  const result = await getMyEventRequests();

  return (
    <>
      <AppHeader />
      <main className="dash__main">
        <Link className="back-link" href="/dashboard">← Back to dashboard</Link>
        <h1>My event requests</h1>
        {"error" in result ? (
          // Refused (not an organiser) or couldn't load: say so, rather than "no requests"
          <div className="alert alert--error" role="alert">{result.error}</div>
        ) : result.requests.length === 0 ? (
          <p className="empty">You have not created any event requests yet.</p>
        ) : (
          <MyEventRequestsTable requests={result.requests} />
        )}
      </main>
    </>
  );
}
