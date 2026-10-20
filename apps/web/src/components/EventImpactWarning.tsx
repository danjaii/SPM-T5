import { AlertTriangle } from "lucide-react";
import type { AffectedArrangement } from "@spm-t5/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatEventDateTime } from "@/lib/formatEventDateTime";

const KIND_LABELS: Record<AffectedArrangement["kind"], string> = {
  venue_booking: "Venue booking",
  equipment_request: "Equipment request",
};

// SCRUM-112: before an important change is saved, the venue bookings and equipment requests it may affect, each with why
// (AC1 to AC3). Save anyway saves it (AC5); Go back leaves the event and its arrangements as they were (AC4).
// SCRUM-128/AC2, AC3: shown as a dialog over the form; closing it by any route is Go back.
export function EventImpactWarning({
  open,
  message,
  affected,
  saving,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  message: string;
  affected: AffectedArrangement[];
  saving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onCancel()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle aria-hidden="true" className="size-5 shrink-0" />
            Check affected arrangements
          </DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <ul aria-label="Affected arrangements" className="flex flex-col gap-3">
          {affected.map((a) => (
            <li key={`${a.kind}-${a.id}`} data-testid="affected-item" className="rounded-lg border border-border p-3">
              <p className="font-semibold">
                {KIND_LABELS[a.kind]}: {a.name}
                {a.quantity !== null && ` × ${a.quantity}`}
              </p>
              <p className="text-sm text-muted-foreground">
                {formatEventDateTime(a.start, a.end)} · {a.statusLabel}
              </p>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {a.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Go back</Button>
          <Button type="button" onClick={onConfirm} disabled={saving}>{saving ? "Saving…" : "Save anyway"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
