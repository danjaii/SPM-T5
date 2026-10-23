"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  EQUIPMENT_REQUEST_REASON_MAX_LENGTH,
  EQUIPMENT_REQUEST_REVIEW_STATUSES,
  EQUIPMENT_REQUEST_STATUS_LABELS,
  parseEquipmentRequestReviewInput,
  type EquipmentRequestReviewStatus,
} from "@spm-t5/shared";
import { AuthAlert } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TextareaField } from "@/components/ui/textarea-field";
import { reviewEquipmentRequest, type EquipmentRequestDetailView } from "@/lib/equipmentRequests";

// SCRUM-87/AC4: Technical Support Staff move a waiting request to Under Review, Arranged or Cannot Fulfil.
// AC5: Cannot Fulfil asks for a reason. Validation is the shared parseEquipmentRequestReviewInput, so the form and
// equipment-service agree. Shown only while the request can be changed; the server checks again, so a stale screen
// just gets a clear refusal (for example, too few units free to mark it Arranged).
// SCRUM-136: shadcn fields, on the request's page and in the queue's Update status dialog, which `onDone` closes.
export function EquipmentRequestReview({
  request,
  onDone,
}: {
  request: Pick<EquipmentRequestDetailView, "id" | "status" | "canReview">;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<EquipmentRequestReviewStatus | "">("");
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  if (!request.canReview) return null;
  // Moving a request to the status it already has changes nothing, so that choice is not offered.
  const choices = EQUIPMENT_REQUEST_REVIEW_STATUSES.filter((s) => s !== request.status);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);

    const parsed = parseEquipmentRequestReviewInput({ status, reason });
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      return;
    }
    setFieldErrors({});

    setSaving(true);
    const { ok, data } = await reviewEquipmentRequest(request.id, { status: parsed.data.status, reason });
    setSaving(false);
    if (ok) {
      setStatus("");
      setReason("");
      router.refresh();
      onDone?.();
      return;
    }
    if (data.fieldErrors) setFieldErrors(data.fieldErrors);
    setError(data.error ?? "We couldn't save the status. Please try again.");
  }

  return (
    <form aria-label="Update status" className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
      {error && <AuthAlert tone="error">{error}</AuthAlert>}

      <FormField id="review-status" label="New status" error={fieldErrors.status}>
        {(c) => (
          <Select value={status || null} onValueChange={(v) => setStatus((v ?? "") as EquipmentRequestReviewStatus | "")}
            items={choices.map((s) => ({ value: s, label: EQUIPMENT_REQUEST_STATUS_LABELS[s] }))}>
            <SelectTrigger {...c} className="w-full">
              <SelectValue placeholder="Choose the new status" />
            </SelectTrigger>
            <SelectContent>
              {choices.map((s) => <SelectItem key={s} value={s}>{EQUIPMENT_REQUEST_STATUS_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </FormField>

      {status === "CANNOT_FULFIL" && (
        <TextareaField
          id="review-reason"
          label="Why it cannot be fulfilled"
          rows={4}
          value={reason}
          error={fieldErrors.reason}
          helper={`${reason.trim().length}/${EQUIPMENT_REQUEST_REASON_MAX_LENGTH}. The Event Coordinator will see this.`}
          onChange={(e) => setReason(e.target.value)}
        />
      )}

      <Button type="submit" className="self-start" disabled={saving}>{saving ? "Saving…" : "Save status"}</Button>
    </form>
  );
}
