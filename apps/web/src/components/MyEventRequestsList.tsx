"use client";

import { useState } from "react";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { statusFilterOptions, type MyEventRequest } from "@/lib/myEventRequests";
import { MyEventRequestsTable } from "./MyEventRequestsTable";
import { statusLabel } from "./EventStatusBadge";

/** SCRUM-55/AC3: the organiser's requests with a status filter. It runs in the browser over the list already loaded. */
export function MyEventRequestsList({ requests }: { requests: MyEventRequest[] }) {
  const [chosen, setChosen] = useState<string | null>(null);

  if (requests.length === 0) return <p className="empty">You have not created any event requests yet.</p>;

  const shown = chosen === null ? requests : requests.filter((request) => request.status === chosen);

  return (
    <>
      <div role="group" aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
        <ChoiceChip label={`All ${requests.length}`} pressed={chosen === null} onPressedChange={() => setChosen(null)} />
        {statusFilterOptions(requests).map(({ status, count }) => (
          <ChoiceChip key={status} label={`${statusLabel(status)} ${count}`} pressed={chosen === status} onPressedChange={() => setChosen(status)} />
        ))}
      </div>
      {shown.length === 0 ? <p className="empty" role="status">No requests match this status.</p> : <MyEventRequestsTable requests={shown} />}
    </>
  );
}
