"use client";

import { Inbox } from "lucide-react";
import { useState } from "react";
import { AuthAlert } from "@/components/auth/AuthParts";
import { MyEventRequestsTable } from "@/components/MyEventRequestsTable";
import { Card } from "@/components/ui/card";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { statusFilterOptions, type MyEventRequest } from "@/lib/myEventRequests";
import { statusLabel } from "./EventStatusBadge";

/**
 * SCRUM-52/AC1: every event request the organiser created, or why it could not load, or that there are none.
 * SCRUM-159: one list for both the organiser's home page (with a `title`) and the My event requests page, so they cannot
 * drift apart.
 * SCRUM-55/AC3: with a status filter, which runs in the browser over the list already loaded.
 */
export function MyEventRequestsList({ result, title }: { result: { requests: MyEventRequest[] } | { error: string }; title?: string }) {
  const [chosen, setChosen] = useState<string | null>(null);

  // Refused (not an organiser) or couldn't load: say so, rather than "no requests"
  if ("error" in result) return <AuthAlert tone="error">{result.error}</AuthAlert>;
  const { requests } = result;

  if (requests.length === 0) {
    return (
      <div data-state="empty" className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-10 text-center">
        <Inbox aria-hidden="true" className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">You have not created any event requests yet.</p>
      </div>
    );
  }

  const shown = chosen === null ? requests : requests.filter((request) => request.status === chosen);

  return (
    <Card className="gap-4 p-2 sm:p-4" role={title ? "region" : undefined} aria-labelledby={title ? "my-event-requests-heading" : undefined}>
      {title && <h2 id="my-event-requests-heading" className="px-2 pt-2 text-lg font-bold text-foreground">{title}</h2>}
      <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2 px-2">
        <ChoiceChip label={`All ${requests.length}`} pressed={chosen === null} onPressedChange={() => setChosen(null)} />
        {statusFilterOptions(requests).map(({ status, count }) => (
          <ChoiceChip key={status} label={`${statusLabel(status)} ${count}`} pressed={chosen === status} onPressedChange={() => setChosen(status)} />
        ))}
      </div>
      {shown.length === 0 ? (
        <p role="status" className="px-2 text-sm text-muted-foreground">No requests match this status.</p>
      ) : (
        <MyEventRequestsTable requests={shown} />
      )}
    </Card>
  );
}
