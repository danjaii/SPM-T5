import type { Metadata } from "next";
import { BookingQueueList } from "@/components/BookingQueueList";
import { PageFrame } from "@/components/PageFrame";
import { Badge } from "@/components/ui/badge";
import { getBookingQueue } from "@/lib/bookingQueueServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Booking requests · ConnectSphere" };

// SCRUM-37: Venue Staff review the pending venue booking requests, first come, first served.
// SCRUM-134: inside the shared app shell, with the count of what is waiting. SCRUM-186/AC1, AC5: the shared page frame.
export default async function BookingQueuePage() {
  const result = await getBookingQueue();

  return (
    <PageFrame
      title="Booking requests"
      description="Approve or reject requests from coordinators, oldest first. Setup and turnaround time are included in each time shown."
      badge={"requests" in result && <Badge variant="info" aria-label={`${result.requests.length} pending`}>{result.requests.length} pending</Badge>}
      error={"requests" in result ? undefined : result.error}
    >
      {"requests" in result && <BookingQueueList requests={result.requests} />}
    </PageFrame>
  );
}
