"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { decideRegistration } from "@/lib/eventRegistration";

// SCRUM-169/AC3: the event's organiser confirms or declines one Pending registration
export function RegistrationDecision({ eventId, registrationId }: { eventId: string; registrationId: string }) {
  const router = useRouter();
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string>();

  async function decide(decision: "confirm" | "decline") {
    setDeciding(true);
    setError(undefined);
    const { ok, data } = await decideRegistration(eventId, registrationId, decision);
    if (ok) router.refresh(); // reload the list from the server, so the status and the places left update
    // SCRUM-169/AC4: event-service's reason, e.g. the event is full
    else setError(data.error);
    setDeciding(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={deciding} onClick={() => decide("confirm")}>Confirm</Button>
        <Button size="sm" variant="outline" disabled={deciding} onClick={() => decide("decline")}>Decline</Button>
      </div>
      {error && <Alert variant="danger">{error}</Alert>}
    </div>
  );
}
