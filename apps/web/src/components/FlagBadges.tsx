import { describeFlag, type FlagDto } from "@spm-t5/shared";
import { StatusBadge } from "@/components/ui/status-badge";
import { FLAG_DISPLAY } from "@/lib/status";

// SCRUM-135/AC1: each open flag on a booking as a Conflict or Venue unavailable badge (icon and label) with the sentence that
// says why. The sentence names a time, never the other event (36-S5).
export function FlagBadges({ flags, venueName, label = "Flags" }: { flags: FlagDto[]; venueName: string; label?: string }) {
  if (flags.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5" aria-label={label || undefined}>
      {flags.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center gap-2">
          <StatusBadge {...FLAG_DISPLAY[f.kind]} />
          <span className="text-xs text-status-warning-fg">{describeFlag(f, venueName)}</span>
        </li>
      ))}
    </ul>
  );
}
