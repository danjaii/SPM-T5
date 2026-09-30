"use client";

import { VenueBookingRequestForm } from "./VenueBookingRequestForm";
import {
  amendVenueBooking,
  type VenueBookingDetailView,
  type VenueBookingFormData,
  type VenueOption,
} from "@/lib/venueBookings";

// SCRUM-60/AC1: amend a rejected request by choosing another venue, date or time. It starts from the
// rejected request's slot; submitting creates a new request and never changes the rejected one.
export function VenueBookingAmendForm({
  rejected,
  form,
  venues,
}: {
  rejected: VenueBookingDetailView;
  form: VenueBookingFormData;
  venues: VenueOption[];
}) {
  return (
    <VenueBookingRequestForm
      form={form}
      venues={venues}
      initial={{
        venueId: rejected.venueId,
        date: rejected.date,
        startTime: rejected.startTime,
        endTime: rejected.endTime,
      }}
      heading="Amend venue request"
      submitLabel="Submit amended request"
      submit={(slot) => amendVenueBooking(rejected.id, slot)}
    />
  );
}
