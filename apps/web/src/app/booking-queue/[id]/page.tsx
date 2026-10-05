import type { Metadata } from "next";
import Link from "next/link";
import { BookingQueueDetail } from "@/components/BookingQueueDetail";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { VenueStaffDecision } from "@/components/VenueStaffDecision";
import { getQueuedBooking } from "@/lib/bookingQueueServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Booking request · ConnectSphere" };

// SCRUM-37: one venue booking request, opened from the queue or by its address.
export default async function QueuedBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getQueuedBooking(id);

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href="/booking-queue">← Back to pending booking requests</Link>
        {"booking" in result ? (
          <>
            <BookingQueueDetail booking={result.booking} />
            {/* SCRUM-38/39: renders only while the request is PENDING; the server checks again. */}
            <VenueStaffDecision booking={{ id: result.booking.id, status: result.booking.status }} />
          </>
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
