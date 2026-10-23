"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lock } from "lucide-react";
import { parseRejectionInput, REJECTION_REASON_MAX_LENGTH, type VenueBookingStatus } from "@spm-t5/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AuthAlert } from "@/components/auth/AuthParts";
import { approveVenueBooking, decisionActions, rejectVenueBooking } from "@/lib/venueBookings";

type Open = "approve" | "reject" | null;

// SCRUM-38 / SCRUM-39: Venue Staff approve or reject a pending request, each in a dialog. Shown only while it is PENDING; the
// server checks again, so a stale screen just gets a clear refusal (NOT_PENDING, SLOT_IN_PAST).
// SCRUM-134/AC2: the Reject dialog cannot be confirmed without a reason; the same schema as the API still checks the length (39-S2).
export function VenueStaffDecision({ booking }: { booking: { id: string; status: VenueBookingStatus | undefined; flagged?: boolean } }) {
  const router = useRouter();
  const allowed = decisionActions(booking.status, booking.flagged);
  const [open, setOpen] = useState<Open>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!allowed.approve && !allowed.reject) return null;

  function close() {
    setOpen(null);
    setError(undefined);
  }

  async function run(action: () => ReturnType<typeof approveVenueBooking>) {
    setBusy(true);
    setError(undefined);
    const { ok, data } = await action();
    if (ok) {
      setOpen(null);
      router.refresh();
    } else {
      setError(data.fieldErrors?.reason ?? data.error ?? "We couldn't complete that. Please try again.");
    }
    setBusy(false);
  }

  function reject() {
    const parsed = parseRejectionInput({ reason });
    if (!parsed.ok) {
      setError(parsed.fieldErrors.reason);
      return;
    }
    return run(() => rejectVenueBooking(booking.id, parsed.data.reason));
  }

  const trimmed = reason.trim();

  return (
    <section className="mt-6 flex flex-col gap-3 border-t border-border pt-4" aria-labelledby="decision-heading">
      <h2 id="decision-heading" className="text-lg font-bold text-foreground">Decision</h2>
      {/* SCRUM-104/AC4: Approve is not offered for a flagged request; say why, and that rejecting is still possible */}
      {booking.flagged && !allowed.approve && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          This request is flagged, so it cannot be approved until the conflict is resolved. You can still reject it.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {allowed.approve && <Button type="button" onClick={() => setOpen("approve")}>Approve request</Button>}
        {allowed.reject && <Button type="button" variant="destructive" onClick={() => setOpen("reject")}>Reject request</Button>}
      </div>

      <Dialog open={open === "approve"} onOpenChange={(o) => !o && !busy && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve this request?</DialogTitle>
            <DialogDescription>The venue is committed to the event for the requested period.</DialogDescription>
          </DialogHeader>
          {error && <AuthAlert tone="error">{error}</AuthAlert>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button>
            <Button type="button" disabled={busy} onClick={() => run(() => approveVenueBooking(booking.id))}>
              {busy ? "Approving…" : "Yes, approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "reject"} onOpenChange={(o) => !o && !busy && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this request?</DialogTitle>
            <DialogDescription>Rejections are final. The Coordinator sees your reason on that venue&apos;s booking.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rejection-reason" className="text-sm font-semibold text-foreground">Reason for rejection</label>
            <Textarea
              id="rejection-reason"
              rows={4}
              value={reason}
              required
              aria-invalid={error ? true : undefined}
              aria-describedby="rejection-reason-count"
              onChange={(e) => setReason(e.target.value)}
            />
            <span id="rejection-reason-count" className="text-xs text-muted-foreground">{trimmed.length}/{REJECTION_REASON_MAX_LENGTH}</span>
          </div>
          {error && <AuthAlert tone="error">{error}</AuthAlert>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={busy || trimmed.length === 0} onClick={reject}>
              {busy ? "Rejecting…" : "Reject request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
