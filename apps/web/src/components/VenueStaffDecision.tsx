"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lock } from "lucide-react";
import { parseRejectionInput, REJECTION_REASON_MAX_LENGTH, type VenueBookingStatus } from "@spm-t5/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AuthAlert } from "@/components/auth/AuthParts";
import { approveVenueBooking, decisionActions, rejectVenueBooking } from "@/lib/venueBookings";

type Open = "approve" | "reject" | null;

const SUGGESTION_NEEDS_FIXING = "Some details of the suggested alternative need fixing. Each one is marked below.";

/** SCRUM-40: a venue Venue Staff may suggest instead. */
export interface SuggestableVenue {
  id: string;
  name: string;
}

const SUGGESTION_FIELDS = ["venueId", "date", "startTime", "endTime"] as const;
type SuggestionField = (typeof SUGGESTION_FIELDS)[number];
type SuggestionValues = Record<SuggestionField, string>;
const NO_SUGGESTION: SuggestionValues = { venueId: "", date: "", startTime: "", endTime: "" };

// SCRUM-38 / SCRUM-39: Venue Staff approve or reject a pending request, each in a dialog. Shown only while it is PENDING; the
// server checks again, so a stale screen just gets a clear refusal (NOT_PENDING, SLOT_IN_PAST).
// SCRUM-134/AC2: the Reject dialog cannot be confirmed without a reason; the same schema as the API still checks the length (39-S2).
// SCRUM-40: with a list of `venues`, the Reject dialog also offers an optional "Suggest an alternative" (a venue, a date and times).
// It is closed by default; the same parser as the API checks it, so a problem is named on its field before anything is sent (40-S4).
export function VenueStaffDecision({
  booking,
  venues,
}: {
  booking: { id: string; status: VenueBookingStatus | undefined; flagged?: boolean };
  venues?: SuggestableVenue[];
}) {
  const router = useRouter();
  const allowed = decisionActions(booking.status, booking.flagged);
  const [open, setOpen] = useState<Open>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<SuggestionValues>(NO_SUGGESTION);
  const [suggestionErrors, setSuggestionErrors] = useState<Partial<Record<SuggestionField, string>>>({});

  if (!allowed.approve && !allowed.reject) return null;

  function close() {
    setOpen(null);
    setError(undefined);
    setSuggestionErrors({});
  }

  /** The field messages of a suggestion, from the shared parser's `suggestion.<field>` keys. */
  function suggestionMessages(fieldErrors: Record<string, string>) {
    const messages: Partial<Record<SuggestionField, string>> = {};
    for (const field of SUGGESTION_FIELDS) if (fieldErrors[`suggestion.${field}`]) messages[field] = fieldErrors[`suggestion.${field}`];
    return messages;
  }

  async function run(action: () => ReturnType<typeof approveVenueBooking>) {
    setBusy(true);
    setError(undefined);
    const { ok, data } = await action();
    if (ok) {
      setOpen(null);
      router.refresh();
    } else {
      const fromServer = suggestionMessages(data.fieldErrors ?? {});
      setSuggestionErrors(fromServer);
      setError(
        data.fieldErrors?.reason ??
          (Object.keys(fromServer).length > 0 ? SUGGESTION_NEEDS_FIXING : undefined) ??
          data.error ??
          "We couldn't complete that. Please try again.",
      );
    }
    setBusy(false);
  }

  function reject() {
    const parsed = parseRejectionInput({ reason, suggestion: suggesting ? suggestion : undefined });
    if (!parsed.ok) {
      setSuggestionErrors(suggestionMessages(parsed.fieldErrors));
      setError(parsed.fieldErrors.reason ?? SUGGESTION_NEEDS_FIXING);
      return;
    }
    setSuggestionErrors({});
    // 40-S2: a suggestion left empty is no suggestion; the parser has already read it as none.
    const given = parsed.data.suggestion;
    const suggested = given ? { venueId: given.venueId, date: given.date, startTime: given.startTime, endTime: given.endTime } : undefined;
    return run(() => rejectVenueBooking(booking.id, parsed.data.reason, suggested));
  }

  const setField = (field: SuggestionField, value: string) => {
    setSuggestion((current) => ({ ...current, [field]: value }));
    setSuggestionErrors((current) => ({ ...current, [field]: undefined }));
    // the summary above the buttons is about the fields marked below it, so it goes once the user starts fixing them
    setError((current) => (current === SUGGESTION_NEEDS_FIXING ? undefined : current));
  };

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
          {venues && venues.length > 0 && (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <input type="checkbox" checked={suggesting} onChange={(e) => setSuggesting(e.target.checked)} className="size-4" />
                Suggest an alternative
              </label>
              {suggesting && (
                <div className="flex flex-col gap-3">
                  <p className="text-xs text-muted-foreground">
                    Optional. The Coordinator sees it and can accept it in one step. It does not hold the venue for them.
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="suggested-venue" className="text-sm font-semibold text-foreground">Suggested venue</label>
                    <select
                      id="suggested-venue"
                      value={suggestion.venueId}
                      onChange={(e) => setField("venueId", e.target.value)}
                      aria-invalid={suggestionErrors.venueId ? true : undefined}
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">Choose a venue</option>
                      {venues.map((v) => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </select>
                    {suggestionErrors.venueId && <p className="text-sm font-medium text-destructive">{suggestionErrors.venueId}</p>}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {(
                      [
                        ["date", "Suggested date", "date"],
                        ["startTime", "Suggested start time", "time"],
                        ["endTime", "Suggested end time", "time"],
                      ] as const
                    ).map(([field, label, type]) => (
                      <div key={field} className="flex flex-col gap-1.5">
                        <label htmlFor={`suggested-${field}`} className="text-sm font-semibold text-foreground">{label}</label>
                        <Input
                          id={`suggested-${field}`}
                          type={type}
                          value={suggestion[field]}
                          aria-invalid={suggestionErrors[field] ? true : undefined}
                          onChange={(e) => setField(field, e.target.value)}
                        />
                        {suggestionErrors[field] && <p className="text-sm font-medium text-destructive">{suggestionErrors[field]}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
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
