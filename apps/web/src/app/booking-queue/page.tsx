import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { BookingQueueList } from "@/components/BookingQueueList";
import { getBookingQueue } from "@/lib/bookingQueueServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Pending booking requests · ConnectSphere" };

// SCRUM-37: Venue Staff review the pending venue booking requests, first come, first served.
export default async function BookingQueuePage() {
  const result = await getBookingQueue();

  return (
    <>
      <AppHeader />
      <main className="dash__main">
        <Link className="back-link" href="/dashboard">← Back to dashboard</Link>
        <h1>Pending booking requests</h1>
        {"requests" in result ? (
          <BookingQueueList requests={result.requests} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
