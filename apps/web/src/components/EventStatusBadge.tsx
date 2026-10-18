import { StatusBadge } from "@/components/ui/status-badge";
import { EVENT_STATUS_DISPLAY, unknownStatusDisplay } from "@/lib/status";
import { isEventStatus } from "@spm-t5/shared";

const displayOf = (status: string) => (isEventStatus(status) ? EVENT_STATUS_DISPLAY[status] : unknownStatusDisplay(status));

export const statusLabel = (status: string) => displayOf(status).label;

interface Props {
  status: string;
}

// SCRUM-120/AC2: renders through StatusBadge, so an event status keeps its tone, icon and label.
export default function EventStatusBadge({ status }: Props) {
  return <StatusBadge {...displayOf(status)} />;
}
