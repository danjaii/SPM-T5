import type { Metadata } from "next";
import Link from "next/link";
import { MyEventRequestsList } from "@/components/MyEventRequestsList";
import { getMyEventRequests } from "@/lib/myEventRequestsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My event requests · ConnectSphere" };

// SCRUM-52: an organiser tracks every event request they created. event-service answers only for organisers and RLS limits the rows to theirs.
// SCRUM-159/AC2: the same page in the new design, inside the shared app shell: the same title, back link and messages.
export default async function MyEventRequestsPage() {
  const result = await getMyEventRequests();

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="space-y-2">
        <Link
          href="/dashboard"
          className="inline-block text-sm font-medium text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          ← Back to dashboard
        </Link>
        <h1 className="font-heading text-2xl font-bold">My event requests</h1>
      </div>
      <MyEventRequestsList result={result} />
    </main>
  );
}
