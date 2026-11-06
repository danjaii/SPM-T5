"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteDraft } from "@/lib/draftDelete";

/**
 * The Next router when the app has mounted one. A list that is rendered without it (a component test, or a page outside the app
 * router) still shows the button, and a delete there falls back to reloading the page.
 */
function useRouterIfMounted() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

/** SCRUM-56: deletes one draft event request, after asking. Reusable wherever a draft is listed (My event requests today, the drafts list of SCRUM-124 next). */
export function DeleteDraftButton({ id, name }: { id: string; name: string }) {
  const router = useRouterIfMounted();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();

  // SCRUM-56/AC3: opening and closing the dialog never sends anything; a reason from an earlier try is not carried over
  function setOpen(open: boolean) {
    if (deleting) return; // not while the request is under way
    setConfirming(open);
    setError(undefined);
  }

  async function remove() {
    setDeleting(true);
    setError(undefined);
    const result = await deleteDraft(id);
    setDeleting(false);
    if (result.ok) {
      // SCRUM-56/AC1: reload the list from the server, where the draft is now gone
      setConfirming(false);
      if (router) router.refresh();
      else window.location.reload();
    } else {
      setError(result.error);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" aria-label={`Delete draft ${name}`} onClick={() => setOpen(true)}>
        Delete
      </Button>
      <Dialog open={confirming} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this draft?</DialogTitle>
            <DialogDescription>
              &ldquo;{name}&rdquo; will be permanently deleted. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          {error && <div className="alert alert--error" role="alert">{error}</div>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={deleting} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={deleting} onClick={remove}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
