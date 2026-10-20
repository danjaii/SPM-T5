import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { ReviewQueue } from "@/components/ReviewQueue";

export const metadata = { title: "Event requests · ConnectSphere" };

export default function ReviewQueuePage() {
  return (
    <>
      <AppHeader>
        <Link href="/dashboard/event_coordinator" className="text-sm underline">
          Back to dashboard
        </Link>
      </AppHeader>
      <main className="dash__main">
        <h1 className="mb-4">Review event requests</h1>
        <ReviewQueue />
      </main>
    </>
  );
}
