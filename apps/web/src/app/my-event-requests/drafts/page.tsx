import type { Metadata } from "next";
import Link from "next/link";
import { DraftsList } from "@/components/DraftsList";
import { getMyEventRequests } from "@/lib/myEventRequestsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Drafts · ConnectSphere" };

// SCRUM-124/AC2: the organiser's drafts on their own, reached from the Drafts item in the navigation. It reads the same list as
// My event requests (SCRUM-52) and keeps the drafts, so the two cannot disagree about what is a draft.
export default async function DraftsPage() {
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
        <h1 className="font-heading text-2xl font-bold">Drafts</h1>
      </div>
      <DraftsList result={result} />
    </main>
  );
}
