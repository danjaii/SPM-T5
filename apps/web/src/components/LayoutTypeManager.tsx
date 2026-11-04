"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { layoutTypeInUseMessage, parseLayoutTypeInput, sameLayoutName, type LayoutTypeUsage, type LayoutTypeView } from "@spm-t5/shared";
import { AuthAlert } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputField } from "@/components/ui/input-field";
import type { ApiResult } from "@/lib/api";
import { deleteLayoutType, patchLayoutType, postLayoutType, type LayoutTypeReply } from "@/lib/layoutTypes";

type Reply = ApiResult<LayoutTypeReply>;

interface Props {
  initial: LayoutTypeView[];
  /** Replaced by a pretend service in tests; default to asking venue-service. */
  api?: {
    add: (name: string) => Promise<Reply>;
    rename: (id: string, name: string) => Promise<Reply>;
    remove: (id: string) => Promise<Reply>;
  };
}

const DUPLICATE = "A layout type with that name already exists.";
const byName = (a: LayoutTypeView, b: LayoutTypeView) => a.name.localeCompare(b.name);

/** The venues that use a layout type, as links to each venue, shown when a delete is refused (181-S4). */
function InUse({ name, usage }: { name: string; usage: LayoutTypeUsage }) {
  return (
    <AuthAlert tone="error">
      <p>{layoutTypeInUseMessage(name, usage)}</p>
      {usage.venues.length > 0 && (
        <ul className="mt-2 list-disc pl-5">
          {usage.venues.map((v) => (
            <li key={v.id}>
              <Link href={`/venues/${v.id}`} className="font-semibold underline underline-offset-4">
                {v.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2">Take the layout off {usage.venues.length > 0 ? "those venues" : "the venues that use it"} (edit the venue) and try again.</p>
    </AuthAlert>
  );
}

// SCRUM-181: Venue Staff add, rename and delete room layout types. Names are checked with the same parser as venue-service
// (parseLayoutTypeInput) and against the list on screen, so a problem is named before anything is sent (181-S5), and whatever
// the server still refuses is shown on the field. A delete asks first (181-S3); when something uses the type the refusal
// lists the venues as links (181-S4). Who may use this is decided by the page; the service and the database refuse the rest.
export function LayoutTypeManager({ initial, api }: Props) {
  const send = api ?? { add: postLayoutType, rename: patchLayoutType, remove: deleteLayoutType };
  const [types, setTypes] = useState<LayoutTypeView[]>(() => [...initial].sort(byName));
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string>();
  const [renaming, setRenaming] = useState<{ id: string; name: string; error?: string }>();
  const [deleting, setDeleting] = useState<LayoutTypeView>();
  const [refusal, setRefusal] = useState<{ name: string; usage: LayoutTypeUsage }>();
  const [failure, setFailure] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  /** The reason to show on a name field, or undefined when the name may be sent. */
  function nameProblem(name: string, exceptId?: string): string | undefined {
    const parsed = parseLayoutTypeInput({ name });
    if (!parsed.ok) return parsed.fieldErrors.name;
    return types.some((t) => t.id !== exceptId && sameLayoutName(t.name, parsed.data.name)) ? DUPLICATE : undefined;
  }

  function clearMessages() {
    setFailure(undefined);
    setNotice(undefined);
    setRefusal(undefined);
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    clearMessages();
    const problem = nameProblem(newName);
    if (problem) return setAddError(problem);
    setAddError(undefined);
    setBusy(true);
    const { ok, data } = await send.add(newName);
    setBusy(false);
    if (ok && data.id && data.name) {
      const added: LayoutTypeView = { id: data.id, name: data.name, isActive: true, venueCount: 0 };
      setTypes((current) => [...current, added].sort(byName));
      setNewName("");
      setNotice(`Added "${data.name}". It is now offered when adding or editing a venue.`);
      return;
    }
    if (data.fieldErrors?.name) return setAddError(data.fieldErrors.name);
    setFailure(data.error ?? "We couldn't add the layout type. Please try again.");
  }

  async function saveRename(e: FormEvent) {
    e.preventDefault();
    if (!renaming) return;
    clearMessages();
    const problem = nameProblem(renaming.name, renaming.id);
    if (problem) return setRenaming({ ...renaming, error: problem });
    setBusy(true);
    const { ok, data } = await send.rename(renaming.id, renaming.name);
    setBusy(false);
    if (ok && data.name) {
      const renamed = data.name;
      setTypes((current) => current.map((t) => (t.id === renaming.id ? { ...t, name: renamed } : t)).sort(byName));
      setRenaming(undefined);
      setNotice(`Renamed to "${renamed}". Venues that use it show the new name.`);
      return;
    }
    if (data.fieldErrors?.name) return setRenaming({ ...renaming, error: data.fieldErrors.name });
    setRenaming(undefined);
    setFailure(data.error ?? "We couldn't rename the layout type. Please try again.");
  }

  async function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    clearMessages();
    setBusy(true);
    const { ok, data } = await send.remove(target.id);
    setBusy(false);
    setDeleting(undefined);
    if (ok) {
      setTypes((current) => current.filter((t) => t.id !== target.id));
      setNotice(`Deleted "${target.name}". It is no longer offered when adding or editing a venue.`);
      return;
    }
    if (data.code === "LAYOUT_TYPE_IN_USE" && data.usedBy) return setRefusal({ name: target.name, usage: data.usedBy });
    setFailure(data.error ?? "We couldn't delete the layout type. Please try again.");
  }

  return (
    <div className="flex flex-col gap-5">
      {failure && <AuthAlert tone="error">{failure}</AuthAlert>}
      {refusal && <InUse name={refusal.name} usage={refusal.usage} />}
      {notice && <AuthAlert tone="ok">{notice}</AuthAlert>}

      <form className="flex flex-col gap-3 sm:flex-row sm:items-start" onSubmit={add} noValidate aria-label="Add a layout type">
        <InputField
          id="new-layout-name"
          label="New layout type"
          className="sm:flex-1"
          value={newName}
          onChange={(e) => { setNewName(e.target.value); setAddError(undefined); }}
          error={addError}
          helper="For example Cabaret or Hollow square. Names are not case sensitive."
          autoComplete="off"
        />
        <Button type="submit" disabled={busy} className="sm:mt-7">
          Add layout type
        </Button>
      </form>

      {types.length === 0 ? (
        <p className="text-sm text-muted-foreground">There are no layout types yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" aria-label="Layout types">
          {types.map((t) => (
            <li key={t.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              {renaming?.id === t.id ? (
                <form className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-start" onSubmit={saveRename} noValidate aria-label={`Rename ${t.name}`}>
                  <InputField
                    id={`rename-${t.id}`}
                    label={`New name for ${t.name}`}
                    className="sm:flex-1"
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: t.id, name: e.target.value })}
                    error={renaming.error}
                    autoComplete="off"
                  />
                  <div className="flex gap-2 sm:mt-7">
                    <Button type="submit" size="sm" disabled={busy}>Save name</Button>
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setRenaming(undefined)}>Cancel</Button>
                  </div>
                </form>
              ) : (
                <>
                  <div>
                    <p className="font-semibold text-foreground">
                      {t.name}
                      {!t.isActive && <span className="ml-2 text-sm font-normal text-muted-foreground">(Inactive)</span>}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t.venueCount === 0 ? "No venues use it" : `${t.venueCount} ${t.venueCount === 1 ? "venue uses" : "venues use"} it`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => { clearMessages(); setRenaming({ id: t.id, name: t.name }); }} aria-label={`Rename ${t.name}`}>
                      Rename
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => { clearMessages(); setDeleting(t); }} aria-label={`Delete ${t.name}`}>
                      Delete
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={deleting !== undefined} onOpenChange={(open) => { if (!open && !busy) setDeleting(undefined); }}>
        {deleting && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="pr-8">Delete &ldquo;{deleting.name}&rdquo;?</DialogTitle>
              <DialogDescription>
                It will no longer be offered when adding or editing a venue. A layout type that a venue uses cannot be deleted.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setDeleting(undefined)}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" disabled={busy} onClick={confirmDelete}>
                Delete layout type
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
