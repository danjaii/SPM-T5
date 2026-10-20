"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { leadChangeCoordinator } from "@/lib/lead";
import type { LeadCoordinator } from "@/lib/leadServer";

// SCRUM-126/AC2: the queue row's "Assign to…" dropdown: each coordinator with their active events, then Assign.
// event-service and the database still decide whether the assignment stands (SCRUM-78/AC5, AC7, AC9).
export function QueueAssignCell({ eventId, eventName, coordinators }: { eventId: string; eventName: string; coordinators: LeadCoordinator[] }) {
  const router = useRouter();
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function assign() {
    if (!choice) return;
    setBusy(true);
    const { ok, data } = await leadChangeCoordinator("assign", eventId, choice);
    if (ok) {
      const name = coordinators.find((c) => c.id === choice)?.full_name;
      toast.success(`${eventName} is now assigned to ${name}. ${name} has been notified.`);
      router.refresh();
    } else {
      toast.error(data.error ?? "We couldn't assign the coordinator. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={choice} onValueChange={setChoice}>
        <SelectTrigger size="sm" aria-label={`Assign ${eventName} to`} className="w-40">
          <SelectValue placeholder="Assign to…">
            {(value: string | null) => coordinators.find((c) => c.id === value)?.full_name ?? "Assign to…"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} className="min-w-56">
          {coordinators.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              <span className="flex flex-col">
                <span className="font-medium">{c.full_name}</span>
                <span className="text-xs text-muted-foreground">
                  {c.workload} active {c.workload === 1 ? "event" : "events"}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" disabled={!choice || busy} onClick={assign} aria-label={`Confirm assigning ${eventName}`}>
        {busy ? "Assigning…" : "Assign"}
      </Button>
    </div>
  );
}
