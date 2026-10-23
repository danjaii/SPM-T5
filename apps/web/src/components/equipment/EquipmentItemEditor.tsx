"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { parseEquipmentRequestInput } from "@spm-t5/shared";
import { AuthAlert } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { InputField } from "@/components/ui/input-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  submitEquipmentRequest,
  updateEquipmentRequest,
  type EquipmentRequestFormData,
  type EquipmentRequestView,
} from "@/lib/equipmentRequests";

// SCRUM-136/AC1: one row on the event's Equipment tab for an item: the equipment (listed under its type), how many, which
// approved venue booking it is for and its technical requirements. A saved item is confirmed with a toast, and the page
// refreshes so it is listed with its status. Validation is the shared parseEquipmentRequestInput, so the row and
// equipment-service agree (SCRUM-86/AC4, AC5): an invalid field is marked and everything typed is kept. SCRUM-136/AC10: a
// refusal is shown in the row, with the field it names marked. Given an `existing` request, the same row changes it,
// starting on its current details (SCRUM-88/AC1); AC2: saving sends it back to Technical Support Staff, which the row
// says first.
export function EquipmentItemEditor({
  form,
  existing,
  onDone,
  onCancel,
}: {
  form: EquipmentRequestFormData;
  existing?: EquipmentRequestView;
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  // An item or venue no longer offered (retired, or no longer approved) starts unchosen, so the coordinator picks again.
  const offered = <T extends { id: string }>(list: T[], id: string | null | undefined) =>
    id && list.some((o) => o.id === id) ? id : "";
  const [equipmentId, setEquipmentId] = useState(offered(form.equipment, existing?.equipmentId));
  const [quantity, setQuantity] = useState(existing ? String(existing.quantity) : "");
  // With one approved venue there is nothing to choose, so it is picked already.
  const [venueBookingId, setVenueBookingId] = useState(
    existing ? offered(form.venues, existing.venueBookingId) : form.venues.length === 1 ? form.venues[0].id : "",
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    const input = { equipmentId, quantity, venueBookingId, notes };
    const parsed = parseEquipmentRequestInput(input);
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      return;
    }
    setFieldErrors({});

    setSaving(true);
    const { ok, data } = existing
      ? await updateEquipmentRequest(form.event.id, existing.id, input)
      : await submitEquipmentRequest(form.event.id, input);
    setSaving(false);
    if (ok) {
      toast.success(existing ? "Equipment request saved" : "Equipment request added");
      router.refresh();
      onDone();
      return;
    }
    if (data.fieldErrors) setFieldErrors(data.fieldErrors);
    setError(data.error ?? "We couldn't save the item. Please try again.");
  }

  return (
    <form aria-label={existing ? "Change equipment item" : "Add equipment item"} onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 lg:grid-cols-12 lg:items-start">
      {error && <div className="lg:col-span-12"><AuthAlert tone="error">{error}</AuthAlert></div>}
      {existing && existing.status !== "SUBMITTED" && (
        <Notice>
          This request is {existing.statusLabel}. Saving a change sends it back to Technical Support Staff as Submitted,
          marked Updated, so they can review it again.
        </Notice>
      )}
      {form.venues.length === 0 && (
        <Notice>
          This event has no approved venue booking yet. Equipment is requested for a booked venue, so request a venue first.
        </Notice>
      )}
      <FormField id="equipmentId" label="Equipment" error={fieldErrors.equipmentId} className="min-w-0 lg:col-span-3">
        {(c) => (
          <Select value={equipmentId || null} onValueChange={(v) => setEquipmentId(v ?? "")}
            items={form.equipment.map((e) => ({ value: e.id, label: e.label }))}>
            <SelectTrigger {...c} className="w-full">
              <SelectValue placeholder="Choose the equipment" />
            </SelectTrigger>
            <SelectContent>
              {form.equipment.map((e) => <SelectItem key={e.id} value={e.id}>{e.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </FormField>
      {/* Text, not type="number": the browser would quietly drop "abc" or "1.5", and the form should say why it's wrong */}
      <InputField id="quantity" label="Quantity" inputMode="numeric" error={fieldErrors.quantity} className="min-w-0 lg:col-span-1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      <FormField id="venueBookingId" label="Venue" error={fieldErrors.venueBookingId} className="min-w-0 lg:col-span-3">
        {(c) => (
          <Select value={venueBookingId || null} onValueChange={(v) => setVenueBookingId(v ?? "")}
            items={form.venues.map((v) => ({ value: v.id, label: venueLabel(v) }))}>
            <SelectTrigger {...c} className="w-full">
              <SelectValue placeholder="Choose the venue" />
            </SelectTrigger>
            <SelectContent>
              {form.venues.map((v) => <SelectItem key={v.id} value={v.id}>{venueLabel(v)}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </FormField>
      <InputField id="notes" label="Technical requirements" error={fieldErrors.notes} className="min-w-0 lg:col-span-3" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex gap-2 lg:col-span-2 lg:mt-7">
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-start gap-2 rounded-lg bg-status-info p-3 text-sm text-status-info-fg lg:col-span-12">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

const venueLabel = (v: EquipmentRequestFormData["venues"][number]) => `${v.venueName} (${v.date}, ${v.startTime}–${v.endTime})`;
