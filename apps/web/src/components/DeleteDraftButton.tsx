"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { deleteDraft } from "@/lib/draftDelete";

/** SCRUM-56: deletes one draft event request. Reusable wherever a draft is listed (My event requests today, the drafts list of SCRUM-124 next). */
export function DeleteDraftButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();

  async function remove() {
    setDeleting(true);
    setError(undefined);
    const result = await deleteDraft(id);
    if (result.ok) {
      // SCRUM-56/AC1: reload the list from the server, where the draft is now gone
      router.refresh();
      return;
    }
    setError(result.error);
    setDeleting(false);
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" aria-label={`Delete draft ${name}`} disabled={deleting} onClick={remove}>
        {deleting ? "Deleting…" : "Delete"}
      </Button>
      {error && <div className="alert alert--error" role="alert">{error}</div>}
    </>
  );
}
