import type { Metadata } from "next";
import Link from "next/link";
import { BookingQueueList } from "@/components/BookingQueueList";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { getBookingQueue } from "@/lib/bookingQueueServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Pending booking requests · ConnectSphere" };

// SCRUM-37: Venue Staff review the pending venue booking requests, first come, first served.
export default async function BookingQueuePage() {
  const result = await getBookingQueue();

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
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
