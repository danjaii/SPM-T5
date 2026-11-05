"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SELECT } from "@/components/VenueUnavailabilityForm";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface BookableEvent {
  id: string;
  name: string;
}

// SCRUM-130 (Figma 09's "+ New booking"): a coordinator picks one of their events that can still take a venue request, and goes to
// that event's Request a venue page (SCRUM-32), where the venue, dates and layout are chosen and checked as before.
export function NewBookingButton({ events }: { events: BookableEvent[] }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState("");
  return (
    <>
      <Button type="button" onClick={() => { setChosen(events[0]?.id ?? ""); setOpen(true); }}>
        <Plus aria-hidden="true" />
        New booking
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New booking</DialogTitle>
            <DialogDescription>Choose the event the venue is for. You then pick the venue, the dates and the layout.</DialogDescription>
          </DialogHeader>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None of your events can take a venue request right now. An event can once it is approved, and until it is confirmed.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="newBookingEvent" className="text-sm font-semibold text-foreground">Event</label>
                <select id="newBookingEvent" className={SELECT} value={chosen} onChange={(e) => setChosen(e.target.value)}>
                  {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <Link href={`/events/${chosen}/venue-request`} className={buttonVariants({ className: "self-start" })}>
                Request a venue
              </Link>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
