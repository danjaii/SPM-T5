import type { Metadata } from "next";
import { AuthAlert } from "@/components/auth/AuthParts";
import { BookingQueueList } from "@/components/BookingQueueList";
import { Badge } from "@/components/ui/badge";
import { getBookingQueue } from "@/lib/bookingQueueServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Booking requests · ConnectSphere" };

// SCRUM-37: Venue Staff review the pending venue booking requests, first come, first served.
// SCRUM-134: inside the shared app shell, with the count of what is waiting.
export default async function BookingQueuePage() {
  const result = await getBookingQueue();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Booking requests</h1>
        {"requests" in result && <Badge variant="info" aria-label={`${result.requests.length} pending`}>{result.requests.length} pending</Badge>}
      </div>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        Approve or reject requests from coordinators, oldest first. Setup and turnaround time are included in each time shown.
      </p>
      {"requests" in result ? <BookingQueueList requests={result.requests} /> : <AuthAlert tone="error">{result.error}</AuthAlert>}
    </main>
  );
}
