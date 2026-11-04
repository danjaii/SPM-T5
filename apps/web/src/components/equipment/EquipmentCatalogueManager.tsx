"use client";

import { useState, type FormEvent } from "react";
import {
  EQUIPMENT_OPERATIONAL_STATUSES,
  EQUIPMENT_OPERATIONAL_STATUS_LABELS,
  parseEquipmentInput,
  type EquipmentCatalogueItem,
  type EquipmentInput,
  type EquipmentInputField,
  type EquipmentOperationalStatus,
} from "@spm-t5/shared";
import { AuthAlert } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { TextareaField } from "@/components/ui/textarea-field";
import type { ApiResult } from "@/lib/api";
import { postEquipment, putEquipment, type EquipmentCatalogueReply } from "@/lib/equipmentCatalogue";
import { OUT_OF_SERVICE_DISPLAY } from "@/lib/status";

type Reply = ApiResult<EquipmentCatalogueReply>;
type Errors = Partial<Record<EquipmentInputField, string>>;

interface Props {
  initial: EquipmentCatalogueItem[];
  /** Replaced by a pretend service in tests; defaults to asking equipment-service. */
  api?: {
    add: (body: Omit<EquipmentInput, "operationalStatus">) => Promise<Reply>;
    edit: (id: string, body: EquipmentInput) => Promise<Reply>;
  };
}

const byName = (a: EquipmentCatalogueItem, b: EquipmentCatalogueItem) => a.name.localeCompare(b.name);

/** The status as the page shows it: a tinted badge with an icon and a label, never colour alone. */
export function OperationalStatusBadge({ status }: { status: EquipmentOperationalStatus }) {
  if (status === "available") return <StatusBadge label={EQUIPMENT_OPERATIONAL_STATUS_LABELS.available} tone="success" icon="check" />;
  return <StatusBadge {...OUT_OF_SERVICE_DISPLAY[status]} />;
}

interface Values {
  name: string;
  type: string;
  description: string;
  totalQuantity: string;
  location: string;
  operationalStatus: EquipmentOperationalStatus;
}

const BLANK: Values = { name: "", type: "", description: "", totalQuantity: "", location: "", operationalStatus: "available" };
const valuesOf = (item: EquipmentCatalogueItem): Values => ({
  name: item.name,
  type: item.type ?? "",
  description: item.description ?? "",
  totalQuantity: String(item.totalQuantity),
  location: item.location ?? "",
  operationalStatus: item.operationalStatus,
});

/** The form for a new item, and (with `editing`) for an existing one, whose status can also be changed. */
function EquipmentForm({
  editing,
  initial,
  onSubmit,
  onCancel,
  busy,
  serverErrors,
}: {
  editing: boolean;
  initial: Values;
  onSubmit: (data: EquipmentInput) => void;
  onCancel?: () => void;
  busy: boolean;
  serverErrors?: Errors;
}) {
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const shown: Errors = { ...serverErrors, ...errors };
  const idPrefix = editing ? "edit" : "new";

  const set = (key: keyof Values, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    // The same parser as equipment-service, so a missing or invalid field is named before anything is sent (182-S4).
    const parsed = parseEquipmentInput(values, editing ? "edit" : "add");
    if (!parsed.ok) return setErrors(parsed.fieldErrors);
    setErrors({});
    onSubmit(parsed.data);
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate aria-label={editing ? `Edit ${initial.name}` : "Add equipment"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <InputField id={`${idPrefix}-name`} label="Name (required)" value={values.name} onChange={(e) => set("name", e.target.value)} error={shown.name} autoComplete="off" />
        <InputField id={`${idPrefix}-type`} label="Type" value={values.type} onChange={(e) => set("type", e.target.value)} error={shown.type} helper="For example AV, Audio or Lighting." autoComplete="off" />
      </div>
      <TextareaField id={`${idPrefix}-description`} label="Description" value={values.description} onChange={(e) => set("description", e.target.value)} error={shown.description} />
      <div className="grid gap-4 sm:grid-cols-2">
        <InputField
          id={`${idPrefix}-quantity`}
          label="Quantity (required)"
          type="text"
          inputMode="numeric"
          value={values.totalQuantity}
          onChange={(e) => set("totalQuantity", e.target.value)}
          error={shown.totalQuantity}
          helper="How many the catalogue holds in total."
        />
        <InputField id={`${idPrefix}-location`} label="Location" value={values.location} onChange={(e) => set("location", e.target.value)} error={shown.location} autoComplete="off" />
      </div>
      {editing && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${idPrefix}-status`} className="text-sm font-semibold text-foreground">
            Status
          </label>
          <select
            id={`${idPrefix}-status`}
            value={values.operationalStatus}
            onChange={(e) => set("operationalStatus", e.target.value)}
            aria-invalid={shown.operationalStatus ? true : undefined}
            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:max-w-xs"
          >
            {EQUIPMENT_OPERATIONAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {EQUIPMENT_OPERATIONAL_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {shown.operationalStatus && <p className="text-sm font-medium text-destructive">{shown.operationalStatus}</p>}
          <p className="text-sm text-muted-foreground">
            An item that is not Available is not offered by the inventory, the availability check or a new reservation.
          </p>
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {editing ? "Save changes" : "Add equipment"}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

// SCRUM-182: Technical Support Staff add equipment, edit it, and change its operational status. The form checks with the same
// parser as equipment-service (parseEquipmentInput), so a problem is named on its field before anything is sent (182-S4), and
// whatever the server still refuses is shown on its field. Who may use this is decided by the page; the service and the database
// refuse the rest.
export function EquipmentCatalogueManager({ initial, api }: Props) {
  const send = api ?? { add: postEquipment, edit: putEquipment };
  const [items, setItems] = useState<EquipmentCatalogueItem[]>(() => [...initial].sort(byName));
  const [editingId, setEditingId] = useState<string>();
  const [addKey, setAddKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [serverErrors, setServerErrors] = useState<Errors>();

  function reset() {
    setFailure(undefined);
    setNotice(undefined);
    setServerErrors(undefined);
  }

  async function add(input: EquipmentInput) {
    reset();
    setBusy(true);
    const { ok, data } = await send.add(input);
    setBusy(false);
    if (ok && data.id) {
      setItems((current) => [...current, { id: data.id as string, ...input }].sort(byName));
      setAddKey((k) => k + 1); // a fresh, empty form
      setNotice(`Added "${input.name}". It is now in the inventory and the availability check.`);
      return;
    }
    if (data.fieldErrors) return setServerErrors(data.fieldErrors as Errors);
    setFailure(data.error ?? "We couldn't add the equipment. Please try again.");
  }

  async function edit(id: string, input: EquipmentInput) {
    reset();
    setBusy(true);
    const { ok, data } = await send.edit(id, input);
    setBusy(false);
    if (ok) {
      setItems((current) => current.map((i) => (i.id === id ? { id, ...input } : i)).sort(byName));
      setEditingId(undefined);
      setNotice(`Saved "${input.name}".`);
      return;
    }
    if (data.fieldErrors) return setServerErrors(data.fieldErrors as Errors);
    setFailure(data.error ?? "We couldn't save the equipment. Please try again.");
  }

  return (
    <div className="flex flex-col gap-6">
      {failure && <AuthAlert tone="error">{failure}</AuthAlert>}
      {notice && <AuthAlert tone="ok">{notice}</AuthAlert>}

      <section className="flex flex-col gap-3 rounded-lg border border-border p-4" aria-labelledby="add-equipment-heading">
        <h2 id="add-equipment-heading" className="text-lg font-bold text-foreground">
          Add equipment
        </h2>
        <EquipmentForm key={addKey} editing={false} initial={BLANK} onSubmit={add} busy={busy} serverErrors={editingId ? undefined : serverErrors} />
      </section>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">There is no equipment in the catalogue yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" aria-label="Equipment catalogue">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-3 p-4">
              {editingId === item.id ? (
                <EquipmentForm
                  editing
                  initial={valuesOf(item)}
                  onSubmit={(v) => edit(item.id, v)}
                  onCancel={() => { setEditingId(undefined); setServerErrors(undefined); }}
                  busy={busy}
                  serverErrors={serverErrors}
                />
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-1">
                    <p className="font-semibold text-foreground">{item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {[item.type, `${item.totalQuantity} in total`, item.location].filter(Boolean).join(" · ")}
                    </p>
                    {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <OperationalStatusBadge status={item.operationalStatus} />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => { reset(); setEditingId(item.id); }}
                      aria-label={`Edit ${item.name}`}
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
