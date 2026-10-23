import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { holdersText, type RequestAvailabilityView } from "@/lib/equipmentRequests";
import { availabilityDisplay, OUT_OF_SERVICE_DISPLAY } from "@/lib/status";

// SCRUM-137/AC1: on a request Technical Support Staff still decide on, whether enough working units are free in its
// time window: "Available 4 / need 6" and a StatusBadge (icon and label), then why the rest are not free.
export function RequestAvailability({ availability }: { availability: RequestAvailabilityView }) {
  const { available, needed, heldBy, outOfService } = availability;
  return (
    <Card aria-labelledby="request-availability-heading" className="gap-3 p-6">
      <h2 id="request-availability-heading" className="text-lg font-bold">Availability at that time</h2>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xl font-semibold text-foreground">{`Available ${available} / need ${needed}`}</p>
        <StatusBadge {...availabilityDisplay(available, needed)} />
      </div>
      {outOfService && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <StatusBadge {...OUT_OF_SERVICE_DISPLAY[outOfService]} /> so none can be used.
        </p>
      )}
      {heldBy.length > 0 && <p className="text-sm text-muted-foreground">Held by other events: {holdersText(heldBy)}.</p>}
    </Card>
  );
}
