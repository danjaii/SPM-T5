import { canFindReplacement } from "@spm-t5/shared";
import type { VenueBookingListItem } from "@/lib/venueBookings";

type Affectable = Pick<VenueBookingListItem, "status" | "flags"> & { replacedBy?: { status?: string } | null };

/** SCRUM-135/AC2: a booking that still holds its venue and carries an open flag. Nothing is removed; it is only listed. */
export const isAffected = (b: Affectable) => (b.status === "PENDING" || b.status === "APPROVED") && b.flags.length > 0;

/** SCRUM-135/AC3: "Find replacement venue" is offered only where SCRUM-107 allows it (unavailable venue, no replacement waiting). */
export const canReplaceVenue = (b: Affectable) =>
  canFindReplacement({
    isAssignedCoordinator: true,
    holding: b.status === "PENDING" || b.status === "APPROVED",
    flags: b.flags,
    hasPendingReplacement: b.replacedBy?.status === "PENDING",
  });

export const replacementHref = (bookingId: string) => `/venue-bookings/${bookingId}/replacement`;
