"use client";

import { CalendarOff, Pencil, Timer } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { VenueTimingForm } from "./VenueTimingForm";
import { VenueUnavailabilityForm } from "./VenueUnavailabilityForm";

interface Props {
  venueId: string;
  venueName: string;
  setupMinutes: number;
  turnaroundMinutes: number;
  /** SCRUM-101: Venue Staff only. */
  canEdit: boolean;
  /** SCRUM-105: Venue Staff only. */
  canMarkUnavailable: boolean;
  /** SCRUM-58: Venue Staff only; edit the venue's details on its own page. */
  canManage?: boolean;
}

const FORM_DIALOG = "max-h-[90dvh] overflow-y-auto sm:max-w-lg";

// SCRUM-129/AC2, AC3: the venue's action buttons. Each opens its form in a dialog; a role that cannot use an action gets
// no button for it (the server and the database refuse them as well).
export function VenueActions({ venueId, venueName, setupMinutes, turnaroundMinutes, canEdit, canMarkUnavailable, canManage = false }: Props) {
  if (!canEdit && !canMarkUnavailable && !canManage) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {canMarkUnavailable && (
        <Dialog>
          <DialogTrigger render={<Button variant="outline" />}>
            <CalendarOff aria-hidden="true" />
            Mark unavailable
          </DialogTrigger>
          <DialogContent className={FORM_DIALOG}>
            <DialogHeader>
              <DialogTitle>Mark {venueName} unavailable</DialogTitle>
              <DialogDescription>
                Dates and times are Singapore time. New requests that overlap the period, including their setup and turnaround, are refused.
              </DialogDescription>
            </DialogHeader>
            <VenueUnavailabilityForm venueId={venueId} />
          </DialogContent>
        </Dialog>
      )}
      {canEdit && (
        <Dialog>
          <DialogTrigger render={<Button variant="outline" />}>
            <Timer aria-hidden="true" />
            Edit times
          </DialogTrigger>
          <DialogContent className={FORM_DIALOG}>
            <DialogHeader>
              <DialogTitle>Edit times for {venueName}</DialogTitle>
              <DialogDescription>
                Setup and turnaround are added to every booking when checking availability and conflicts. Changing them flags existing
                bookings that no longer fit; nothing is removed.
              </DialogDescription>
            </DialogHeader>
            <VenueTimingForm venueId={venueId} setupMinutes={setupMinutes} turnaroundMinutes={turnaroundMinutes} />
          </DialogContent>
        </Dialog>
      )}
      {canManage && (
        <Link href={`/venues/${encodeURIComponent(venueId)}/edit`} className={buttonVariants()}>
          <Pencil aria-hidden="true" />
          Edit venue
        </Link>
      )}
    </div>
  );
}
