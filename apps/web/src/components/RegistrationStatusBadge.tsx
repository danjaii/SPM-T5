import type { RegistrationStatus } from "@spm-t5/shared";
import { StatusBadge } from "@/components/ui/status-badge";
import { REGISTRATION_STATUS_DISPLAY } from "@/lib/status";

// SCRUM-139/AC7: an attendee's registration status as a StatusBadge, so it always has a tone, an icon and a label.
export function RegistrationStatusBadge({ status }: { status: RegistrationStatus }) {
  return <StatusBadge {...REGISTRATION_STATUS_DISPLAY[status]} />;
}
