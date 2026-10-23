"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { EquipmentQueueItemView } from "@/lib/equipmentRequests";
import { EquipmentRequestReview } from "../EquipmentRequestReview";

// SCRUM-136/AC2 (Figma frame 11): Technical Support Staff update an item's status from the queue, without leaving it. The
// form is SCRUM-87's; every item in the queue is still waiting, so it can be reviewed. Saving closes the dialog.
export function EquipmentStatusDialog({ request }: { request: EquipmentQueueItemView }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-label={`Update the status of ${request.equipment}`}>
        Update status
      </Button>
      {open && (
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="pr-8">Update status: {request.equipment}</DialogTitle>
            <DialogDescription>{request.eventName} · {request.eventDate} · {request.quantity} needed</DialogDescription>
          </DialogHeader>
          <EquipmentRequestReview request={{ id: request.id, status: request.status, canReview: true }} onDone={() => setOpen(false)} />
        </DialogContent>
      )}
    </Dialog>
  );
}
