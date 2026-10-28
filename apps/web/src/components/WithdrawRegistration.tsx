"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { withdrawRegistration, type MyRegistration } from "@/lib/eventRegistration";

// SCRUM-73: the attendee withdraws one of their registrations from "My registrations"
export function WithdrawRegistration({ registration }: { registration: MyRegistration }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);
  const [error, setError] = useState<string>();
  // SCRUM-73/AC2: only a Pending or Confirmed registration can be withdrawn
  const active = registration.status === "pending" || registration.status === "confirmed";

  // SCRUM-73/AC6: once confirmed, withdraw, say so, and reload the list from the server so the status reads Withdrawn
  async function withdraw() {
    const { ok, data } = await withdrawRegistration(registration.id);
    if (ok) {
      setConfirming(false);
      setWithdrawn(true);
      router.refresh();
    } else {
      // event-service's reason, e.g. the event was cancelled after the page loaded
      setError(data.error);
    }
  }

  return (
    <>
      {withdrawn && (
        <p role="status" className="text-sm font-medium text-foreground">You have withdrawn from {registration.event.name}.</p>
      )}
      {active && (
        // SCRUM-73/AC5: disabled once the event has started, ended or been cancelled (event-service's can_withdraw)
        <Button variant="outline" size="sm" disabled={!registration.can_withdraw} onClick={() => setConfirming(true)}>
          Withdraw
        </Button>
      )}
      {/* SCRUM-73/AC3: a pop-up asks the attendee to confirm before anything is sent */}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw from {registration.event.name}?</DialogTitle>
            <DialogDescription>Your place will be given up so that someone else can attend.</DialogDescription>
          </DialogHeader>
          {error && <Alert variant="danger">{error}</Alert>}
          <DialogFooter>
            {/* SCRUM-73/AC4: the attendee can back out without changing anything */}
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={withdraw}>
              Yes, withdraw
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
